import { parseVehiclePositions, parseTripUpdates, parseAlerts } from '../gtfs-rt/parsers';
import { scheduledArrivalMs, utcMsToLocalDate } from '../gtfs-rt/schedule-time';

export interface ParseJob {
	snapshotId: string;
	agencyId: string;
	feedType: string;
	r2Key: string;
	gtfsVersionId: string;
	tsMs: number;
}

// ---------------------------------------------------------------------------
// Module-level LRU cache for gtfs_stop_times scheduled arrival strings.
// Key: "${gtfs_version_id}|${trip_id}|${stop_sequence}"
// Value: arrival_time text (e.g. "08:30:00" or "25:13:00")
// ---------------------------------------------------------------------------
const STOP_TIMES_CACHE_MAX = 20_000;
const stopTimesCache = new Map<string, string | null>();

function cacheGet(key: string): string | null | undefined {
	if (!stopTimesCache.has(key)) return undefined;
	// Move to end (most-recently-used).
	const val = stopTimesCache.get(key)!;
	stopTimesCache.delete(key);
	stopTimesCache.set(key, val);
	return val;
}

function cacheSet(key: string, val: string | null): void {
	if (stopTimesCache.size >= STOP_TIMES_CACHE_MAX) {
		// Evict oldest entry (first key).
		stopTimesCache.delete(stopTimesCache.keys().next().value!);
	}
	stopTimesCache.set(key, val);
}

// ---------------------------------------------------------------------------
// Agency timezone cache (fetched once per agency per isolate lifetime)
// ---------------------------------------------------------------------------
const agencyTzCache = new Map<string, string>();

async function getAgencyTimezone(db: D1Database, agencyId: string): Promise<string> {
	const cached = agencyTzCache.get(agencyId);
	if (cached) return cached;
	const row = await db.prepare('SELECT timezone FROM agencies WHERE agency_id = ?')
		.bind(agencyId).first<{ timezone: string }>();
	const tz = row?.timezone ?? 'UTC';
	agencyTzCache.set(agencyId, tz);
	return tz;
}

// ---------------------------------------------------------------------------
// Batch-fetch stop_times for all distinct (trip_id, stop_sequence) pairs in
// a message that are not already in the cache.
// ---------------------------------------------------------------------------
function chunkArray<T>(arr: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

async function primeStopTimesCache(
	db: D1Database,
	gtfsVersionId: string,
	agencyId: string,
	pairs: Array<{ tripId: string; stopSequence: number | null }>,
): Promise<void> {
	const missing = pairs.filter(p => {
		if (p.stopSequence === null) return false;
		return cacheGet(`${gtfsVersionId}|${p.tripId}|${p.stopSequence}`) === undefined;
	});
	if (missing.length === 0) return;

	const distinctTripIds = [...new Set(missing.map(p => p.tripId))];

	// Chunk to avoid D1 "too many SQL variables" (limit 100 params per statement).
	const CHUNK = 80;
	for (const chunk of chunkArray(distinctTripIds, CHUNK)) {
		const placeholders = chunk.map(() => '?').join(',');
		const rows = await db.prepare(
			`SELECT trip_id, stop_sequence, arrival_time
			 FROM gtfs_stop_times
			 WHERE agency_id = ? AND gtfs_version_id = ? AND trip_id IN (${placeholders})`
		).bind(agencyId, gtfsVersionId, ...chunk).all<{
			trip_id: string;
			stop_sequence: number;
			arrival_time: string | null;
		}>();

		for (const row of rows.results ?? []) {
			const key = `${gtfsVersionId}|${row.trip_id}|${row.stop_sequence}`;
			cacheSet(key, row.arrival_time ?? null);
		}
	}

	// Mark any pairs we still couldn't find as null (no static entry).
	for (const p of missing) {
		if (p.stopSequence === null) continue;
		const key = `${gtfsVersionId}|${p.tripId}|${p.stopSequence}`;
		if (cacheGet(key) === undefined) cacheSet(key, null);
	}
}

export async function handleParseQueue(
	batch: MessageBatch<ParseJob>,
	env: Env
): Promise<void> {
	if (!env.ARCHIVE_BUCKET || !env.DB) {
		console.error('Missing required bindings for parse queue');
		return;
	}

	for (const message of batch.messages) {
		const job = message.body;

		try {
			const r2Object = await env.ARCHIVE_BUCKET.get(job.r2Key);
			if (!r2Object) {
				console.error(`R2 object not found: ${job.r2Key}`);
				message.ack();
				continue;
			}

			const protobufBytes = new Uint8Array(await r2Object.arrayBuffer());

			if (job.feedType === 'vehicle-positions') {
				const positions = parseVehiclePositions(protobufBytes, job.agencyId, job.gtfsVersionId);
				
				if (positions.length > 0) {
					// Write to R2 Pipeline (permanent archive) - best effort
					if (env.VP_PIPELINE) {
						try {
							const pipelineRecords = positions.map(p => ({
								agency_id: p.agencyId,
								ts_ms: p.tsMs,
								vehicle_id: p.vehicleId,
								trip_id: p.tripId,
								route_id: p.routeId,
								direction_id: p.directionId,
								stop_id: p.stopId,
								lat: p.lat,
								lon: p.lon,
								bearing: p.bearing,
								speed: p.speed,
								current_status: p.currentStatus,
								current_stop_sequence: p.currentStopSequence,
								gtfs_version_id: p.gtfsVersionId,
							}));
							await env.VP_PIPELINE.send(pipelineRecords);
						} catch (pipelineError) {
							console.error(`⚠️ VP Pipeline write failed (data still in D1):`, pipelineError);
						}
					}

					// Write to D1 (hot cache)
					try {
						const statements = positions.map(p => 
							env.DB!.prepare(
								`INSERT INTO vp_points (agency_id, ts_ms, vehicle_id, trip_id, route_id, direction_id, stop_id, lat, lon, bearing, speed, current_status, current_stop_sequence, gtfs_version_id) 
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
							).bind(p.agencyId, p.tsMs, p.vehicleId, p.tripId, p.routeId, p.directionId, p.stopId, p.lat, p.lon, p.bearing, p.speed, p.currentStatus, p.currentStopSequence, p.gtfsVersionId)
						);
						// D1 batch limit: 100 statements per batch.
						for (const chunk of chunkArray(statements, 100)) {
							await env.DB!.batch(chunk);
						}
						console.log(`✅ Inserted ${positions.length} vehicle positions`);
					} catch (insertError) {
						console.error(`❌ D1 VP insert failed (data safe in Pipeline):`, insertError);
					}
				}
			} else if (job.feedType === 'trip-updates') {
				const updates = parseTripUpdates(protobufBytes, job.agencyId, job.gtfsVersionId);
				
				if (updates.length > 0) {
					// Fetch agency timezone once per message.
					const tz = await getAgencyTimezone(env.DB, job.agencyId);

					// Prime the stop-times cache for all (trip_id, stop_sequence) pairs.
					await primeStopTimesCache(
						env.DB,
						job.gtfsVersionId,
						job.agencyId,
						updates.map(u => ({ tripId: u.tripId, stopSequence: u.stopSequence })),
					);

					// Compute delay_seconds for each update.
					const updatesWithDelay = updates.map(u => {
						let delaySec: number | null = null;
						let resolvedStartDate = u.startDate;

						if (u.arrivalTimeMs !== null && u.stopSequence !== null) {
							// Determine start_date: use TripDescriptor.startDate if present,
							// otherwise infer from ts_ms (local civil date).
							if (!resolvedStartDate) {
								resolvedStartDate = utcMsToLocalDate(u.tsMs, tz);
							}

							const arrivalKey = `${job.gtfsVersionId}|${u.tripId}|${u.stopSequence}`;
							const scheduledArrivalStr = cacheGet(arrivalKey);

							if (scheduledArrivalStr) {
								try {
									const schedMs = scheduledArrivalMs(tz, resolvedStartDate, scheduledArrivalStr);
									// If the naive scheduled time ends up >12h ahead of ts_ms,
									// the trip likely started the previous local day — subtract one day.
									let finalSchedMs = schedMs;
									if (finalSchedMs - u.tsMs > 12 * 3600 * 1000) {
										finalSchedMs -= 24 * 3600 * 1000;
									}
									delaySec = Math.round((u.arrivalTimeMs - finalSchedMs) / 1000);
								} catch {
									// leave delaySec null
								}
							}
						}

						return { ...u, delaySec, resolvedStartDate };
					});

					// Write to R2 Pipeline (permanent archive) - best effort
					if (env.TU_PIPELINE) {
						try {
							const pipelineRecords = updatesWithDelay.map(u => ({
								agency_id: u.agencyId,
								ts_ms: u.tsMs,
								trip_id: u.tripId,
								route_id: u.routeId,
								stop_id: u.stopId,
								stop_sequence: u.stopSequence,
								arrival_time_ms: u.arrivalTimeMs,
								departure_time_ms: u.departureTimeMs,
								schedule_relationship: u.scheduleRelationship,
								gtfs_version_id: u.gtfsVersionId,
								delay_seconds: u.delaySec,
								start_date: u.resolvedStartDate,
							}));
							await env.TU_PIPELINE.send(pipelineRecords);
						} catch (pipelineError) {
							console.error(`⚠️ TU Pipeline write failed (data still in D1):`, pipelineError);
						}
					}

					// Write to D1 (hot cache)
					try {
						const statements = updatesWithDelay.map(u =>
							env.DB!.prepare(
								`INSERT INTO tu_stop_time_updates (agency_id, ts_ms, trip_id, route_id, stop_id, stop_sequence, arrival_time_ms, departure_time_ms, schedule_relationship, gtfs_version_id, delay_seconds, start_date) 
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
							).bind(u.agencyId, u.tsMs, u.tripId, u.routeId, u.stopId, u.stopSequence, u.arrivalTimeMs, u.departureTimeMs, u.scheduleRelationship, u.gtfsVersionId, u.delaySec, u.resolvedStartDate)
						);
						// D1 batch limit: 100 statements per batch.
						for (const chunk of chunkArray(statements, 100)) {
							await env.DB!.batch(chunk);
						}
						console.log(`✅ Inserted ${updates.length} trip updates`);
					} catch (insertError) {
						console.error(`❌ D1 TU insert failed (data safe in Pipeline):`, insertError);
					}
				}
			} else if (job.feedType === 'alerts') {
				const alerts = parseAlerts(protobufBytes, job.agencyId, job.gtfsVersionId);
				console.log(`Parsed ${alerts.length} alerts (not stored yet)`);
			}

			message.ack();
		} catch (error) {
			console.error(`Error parsing ${job.snapshotId}:`, error);
			message.retry();
		}
	}
}
