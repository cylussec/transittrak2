export async function fetchGtfsStatic(
	agencyId: string,
	gtfsStaticUrl: string,
	env: Env
): Promise<{ gtfsVersionId: string; r2Key: string; fetchedAtMs: number } | null> {
	if (!env.ARCHIVE_BUCKET || !env.DB) return null;

	const fetchedAtMs = Date.now();

	const response = await fetch(gtfsStaticUrl);
	if (!response.ok) {
		console.error(`Failed to fetch GTFS static for ${agencyId}: ${response.status}`);
		return null;
	}

	const zipBytes = await response.arrayBuffer();
	const sha256 = await computeSha256(zipBytes);
	const gtfsVersionId = `${agencyId}:${sha256}`;

	const existingVersion = await env.DB.prepare(
		'SELECT gtfs_version_id FROM gtfs_versions WHERE gtfs_version_id = ?'
	)
		.bind(gtfsVersionId)
		.first();

	if (existingVersion) {
		console.log(`GTFS version ${gtfsVersionId} already exists, skipping`);
		return null;
	}

	const r2Key = `gtfs-static/${agencyId}/hash=${sha256}/fetched_at=${fetchedAtMs}.zip`;

	await env.ARCHIVE_BUCKET.put(r2Key, zipBytes, {
		httpMetadata: {
			contentType: 'application/zip',
		},
		customMetadata: {
			agency_id: agencyId,
			gtfs_version_id: gtfsVersionId,
			fetched_at_ms: String(fetchedAtMs),
			sha256,
		},
	});

	await env.DB.prepare(
		'INSERT INTO gtfs_versions (gtfs_version_id, agency_id, fetched_at_ms, r2_key) VALUES (?, ?, ?, ?)'
	)
		.bind(gtfsVersionId, agencyId, fetchedAtMs, r2Key)
		.run();

	await env.DB.prepare(
		'INSERT INTO gtfs_version_effective (agency_id, effective_from_ms, gtfs_version_id) VALUES (?, ?, ?)'
	)
		.bind(agencyId, fetchedAtMs, gtfsVersionId)
		.run();

	console.log(`Fetched and stored GTFS static version ${gtfsVersionId}`);

	return { gtfsVersionId, r2Key, fetchedAtMs };
}

async function computeSha256(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
