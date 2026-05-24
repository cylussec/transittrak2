import Papa from 'papaparse';

interface ZipEntry {
	name: string;
	getData: (writer: WritableStream) => Promise<void>;
}

export async function parseAndStoreGtfsStatic(
	agencyId: string,
	gtfsVersionId: string,
	r2Key: string,
	env: Env
): Promise<void> {
	if (!env.ARCHIVE_BUCKET || !env.DB) return;

	const r2Object = await env.ARCHIVE_BUCKET.get(r2Key);
	if (!r2Object) {
		console.error(`R2 object not found: ${r2Key}`);
		return;
	}

	const zipBytes = await r2Object.arrayBuffer();
	const files = await extractZipFiles(zipBytes);
	const db = env.DB;

	// Routes (critical for colors)
	const routesFile = files.get('routes.txt');
	if (routesFile) {
		const routes = parseRoutes(routesFile, agencyId, gtfsVersionId);
		if (routes.length > 0) {
			const stmts = routes.map(r =>
				db.prepare('INSERT OR IGNORE INTO gtfs_routes (route_id, agency_id, gtfs_version_id, route_short_name, route_long_name, route_desc, route_type, route_url, route_color, route_text_color, route_sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
					.bind(r.routeId, r.agencyId, r.gtfsVersionId, r.routeShortName, r.routeLongName, r.routeDesc, r.routeType, r.routeUrl, r.routeColor, r.routeTextColor, r.routeSortOrder)
			);
			for (const batch of chunkArray(stmts, 50)) {
				await db.batch(batch);
			}
			console.log(`Parsed ${routes.length} routes`);
		}
	}

	// Stops (critical for stringline chart)
	const stopsFile = files.get('stops.txt');
	if (stopsFile) {
		const stops = parseStops(stopsFile, agencyId, gtfsVersionId);
		if (stops.length > 0) {
			const stmts = stops.map(s =>
				db.prepare('INSERT OR IGNORE INTO gtfs_stops (stop_id, agency_id, gtfs_version_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station, stop_timezone, wheelchair_boarding) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
					.bind(s.stopId, s.agencyId, s.gtfsVersionId, s.stopCode, s.stopName, s.stopDesc, s.stopLat, s.stopLon, s.zoneId, s.stopUrl, s.locationType, s.parentStation, s.stopTimezone, s.wheelchairBoarding)
			);
			for (const batch of chunkArray(stmts, 50)) {
				await db.batch(batch);
			}
			console.log(`Parsed ${stops.length} stops`);
		}
	}

	// Trips (needed for route→trip→stop_times joins)
	const tripsFile = files.get('trips.txt');
	if (tripsFile) {
		const trips = parseTrips(tripsFile, agencyId, gtfsVersionId);
		if (trips.length > 0) {
			const stmts = trips.map(t =>
				db.prepare('INSERT OR IGNORE INTO gtfs_trips (trip_id, agency_id, gtfs_version_id, route_id, service_id, trip_headsign, trip_short_name, direction_id, block_id, shape_id, wheelchair_accessible, bikes_allowed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
					.bind(t.tripId, t.agencyId, t.gtfsVersionId, t.routeId, t.serviceId, t.tripHeadsign, t.tripShortName, t.directionId, t.blockId, t.shapeId, t.wheelchairAccessible, t.bikesAllowed)
			);
			for (const batch of chunkArray(stmts, 50)) {
				await db.batch(batch);
			}
			console.log(`Parsed ${trips.length} trips`);
		}
	}

	// Stop times and shapes skipped - too large for Worker CPU limits
	// TODO: implement queue-based async parsing for these large tables
	console.log(`GTFS static parse complete for ${agencyId}`);
}

function parseRoutes(csvContent: string, agencyId: string, gtfsVersionId: string) {
	const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
	return parsed.data.map((row) => ({
		routeId: row.route_id,
		agencyId,
		gtfsVersionId,
		routeShortName: row.route_short_name || null,
		routeLongName: row.route_long_name || null,
		routeDesc: row.route_desc || null,
		routeType: parseInt(row.route_type, 10),
		routeUrl: row.route_url || null,
		routeColor: row.route_color || null,
		routeTextColor: row.route_text_color || null,
		routeSortOrder: row.route_sort_order ? parseInt(row.route_sort_order, 10) : null,
	}));
}

function parseStops(csvContent: string, agencyId: string, gtfsVersionId: string) {
	const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
	return parsed.data.map((row) => ({
		stopId: row.stop_id,
		agencyId,
		gtfsVersionId,
		stopCode: row.stop_code || null,
		stopName: row.stop_name,
		stopDesc: row.stop_desc || null,
		stopLat: parseFloat(row.stop_lat),
		stopLon: parseFloat(row.stop_lon),
		zoneId: row.zone_id || null,
		stopUrl: row.stop_url || null,
		locationType: row.location_type ? parseInt(row.location_type, 10) : null,
		parentStation: row.parent_station || null,
		stopTimezone: row.stop_timezone || null,
		wheelchairBoarding: row.wheelchair_boarding ? parseInt(row.wheelchair_boarding, 10) : null,
	}));
}

function parseShapes(csvContent: string, agencyId: string, gtfsVersionId: string) {
	const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
	return parsed.data.map((row) => ({
		shapeId: row.shape_id,
		agencyId,
		gtfsVersionId,
		shapePtLat: parseFloat(row.shape_pt_lat),
		shapePtLon: parseFloat(row.shape_pt_lon),
		shapePtSequence: parseInt(row.shape_pt_sequence, 10),
		shapeDistTraveled: row.shape_dist_traveled ? parseFloat(row.shape_dist_traveled) : null,
	}));
}

function parseTrips(csvContent: string, agencyId: string, gtfsVersionId: string) {
	const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
	return parsed.data.map((row) => ({
		tripId: row.trip_id,
		agencyId,
		gtfsVersionId,
		routeId: row.route_id,
		serviceId: row.service_id,
		tripHeadsign: row.trip_headsign || null,
		tripShortName: row.trip_short_name || null,
		directionId: row.direction_id ? parseInt(row.direction_id, 10) : null,
		blockId: row.block_id || null,
		shapeId: row.shape_id || null,
		wheelchairAccessible: row.wheelchair_accessible ? parseInt(row.wheelchair_accessible, 10) : null,
		bikesAllowed: row.bikes_allowed ? parseInt(row.bikes_allowed, 10) : null,
	}));
}

function parseStopTimes(csvContent: string, agencyId: string, gtfsVersionId: string) {
	const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
	return parsed.data.map((row) => ({
		tripId: row.trip_id,
		agencyId,
		gtfsVersionId,
		arrivalTime: row.arrival_time || null,
		departureTime: row.departure_time || null,
		stopId: row.stop_id,
		stopSequence: parseInt(row.stop_sequence, 10),
		stopHeadsign: row.stop_headsign || null,
		pickupType: row.pickup_type ? parseInt(row.pickup_type, 10) : null,
		dropOffType: row.drop_off_type ? parseInt(row.drop_off_type, 10) : null,
		shapeDistTraveled: row.shape_dist_traveled ? parseFloat(row.shape_dist_traveled) : null,
		timepoint: row.timepoint ? parseInt(row.timepoint, 10) : null,
	}));
}

async function extractZipFiles(zipBytes: ArrayBuffer): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	const dv = new DataView(zipBytes);

	// Find End of Central Directory record (scan backwards)
	let eocdOffset = -1;
	for (let i = zipBytes.byteLength - 22; i >= 0; i--) {
		if (dv.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) return files;

	const cdOffset = dv.getUint32(eocdOffset + 16, true);
	const cdEntries = dv.getUint16(eocdOffset + 10, true);

	// Read central directory entries (they always have correct sizes)
	let pos = cdOffset;
	for (let i = 0; i < cdEntries; i++) {
		if (dv.getUint32(pos, true) !== 0x02014b50) break;

		const compressionMethod = dv.getUint16(pos + 10, true);
		const compressedSize = dv.getUint32(pos + 20, true);
		const fileNameLength = dv.getUint16(pos + 28, true);
		const extraFieldLength = dv.getUint16(pos + 30, true);
		const commentLength = dv.getUint16(pos + 32, true);
		const localHeaderOffset = dv.getUint32(pos + 42, true);

		const fileName = new TextDecoder().decode(
			new Uint8Array(zipBytes, pos + 46, fileNameLength)
		);

		// Read local file header to find data start
		const localFileNameLen = dv.getUint16(localHeaderOffset + 26, true);
		const localExtraLen = dv.getUint16(localHeaderOffset + 28, true);
		const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

		if (!fileName.endsWith('/') && compressedSize > 0) {
			if (compressionMethod === 0) {
				const content = new TextDecoder().decode(
					new Uint8Array(zipBytes, dataOffset, compressedSize)
				);
				files.set(fileName, content);
			} else if (compressionMethod === 8) {
				const compressedData = new Uint8Array(zipBytes, dataOffset, compressedSize);
				const decompressed = await decompressDeflate(compressedData);
				files.set(fileName, new TextDecoder().decode(decompressed));
			}
		}

		pos += 46 + fileNameLength + extraFieldLength + commentLength;
	}

	return files;
}

async function decompressDeflate(compressed: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream('deflate-raw');
	const writer = ds.writable.getWriter();
	writer.write(compressed);
	writer.close();

	const chunks: Uint8Array[] = [];
	const reader = ds.readable.getReader();
	
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}

	const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result;
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
}
