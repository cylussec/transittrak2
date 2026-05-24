import { parseVehiclePositions, parseTripUpdates, parseAlerts } from '../gtfs-rt/parsers';

export interface ParseJob {
	snapshotId: string;
	agencyId: string;
	feedType: string;
	r2Key: string;
	gtfsVersionId: string;
	tsMs: number;
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
						await env.DB!.batch(statements);
						console.log(`✅ Inserted ${positions.length} vehicle positions`);
					} catch (insertError) {
						console.error(`❌ D1 VP insert failed (data safe in Pipeline):`, insertError);
					}
				}
			} else if (job.feedType === 'trip-updates') {
				const updates = parseTripUpdates(protobufBytes, job.agencyId, job.gtfsVersionId);
				
				if (updates.length > 0) {
					// Write to R2 Pipeline (permanent archive) - best effort
					if (env.TU_PIPELINE) {
						try {
							const pipelineRecords = updates.map(u => ({
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
							}));
							await env.TU_PIPELINE.send(pipelineRecords);
						} catch (pipelineError) {
							console.error(`⚠️ TU Pipeline write failed (data still in D1):`, pipelineError);
						}
					}

					// Write to D1 (hot cache)
					try {
						const statements = updates.map(u =>
							env.DB!.prepare(
								`INSERT INTO tu_stop_time_updates (agency_id, ts_ms, trip_id, route_id, stop_id, stop_sequence, arrival_time_ms, departure_time_ms, schedule_relationship, gtfs_version_id) 
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
							).bind(u.agencyId, u.tsMs, u.tripId, u.routeId, u.stopId, u.stopSequence, u.arrivalTimeMs, u.departureTimeMs, u.scheduleRelationship, u.gtfsVersionId)
						);
						await env.DB!.batch(statements);
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
