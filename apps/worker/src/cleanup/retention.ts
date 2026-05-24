/**
 * D1 hot-cache retention — size-based cleanup.
 *
 * Permanent data lives in R2 Data Catalog (Iceberg/Parquet via Pipelines).
 * D1 is only a hot cache for fast dashboard queries.
 *
 * This cron checks D1 size and, when it exceeds a threshold, removes the
 * oldest records that are already archived in R2.  It deletes in small
 * batches to stay within D1's per-request limits.
 */

const D1_SIZE_THRESHOLD_MB = 8_000; // Start cleanup when DB > 8 GB (limit is 10 GB)
const BATCH_DELETE_LIMIT = 10_000;

export interface CleanupResult {
	dbSizeMb: number;
	thresholdMb: number;
	vpDeleted: number;
	tuDeleted: number;
	snapshotsDeleted: number;
	skipped: boolean;
}

export async function cleanupD1HotCache(env: Env): Promise<CleanupResult> {
	const result: CleanupResult = {
		dbSizeMb: 0,
		thresholdMb: D1_SIZE_THRESHOLD_MB,
		vpDeleted: 0,
		tuDeleted: 0,
		snapshotsDeleted: 0,
		skipped: false,
	};

	if (!env.DB) {
		console.error('DB binding not available for cleanup');
		result.skipped = true;
		return result;
	}

	// Check current database size
	try {
		result.dbSizeMb = await getD1SizeMb(env);
		console.log(`D1 size: ${result.dbSizeMb} MB (threshold: ${D1_SIZE_THRESHOLD_MB} MB)`);

		if (result.dbSizeMb >= 0 && result.dbSizeMb < D1_SIZE_THRESHOLD_MB) {
			console.log('D1 size under threshold, skipping cleanup');
			result.skipped = true;
			return result;
		}
	} catch (error) {
		console.error('Failed to check DB size, running cleanup as precaution:', error);
	}

	console.log('🧹 D1 over threshold — aging off oldest hot-cache data...');

	try {
		// Delete oldest trip updates first (largest table by far)
		while (true) {
			const res = await env.DB.prepare(
				`DELETE FROM tu_stop_time_updates WHERE rowid IN (SELECT rowid FROM tu_stop_time_updates ORDER BY ts_ms ASC LIMIT ?)`
			).bind(BATCH_DELETE_LIMIT).run();

			const deleted = res.meta.changes || 0;
			result.tuDeleted += deleted;
			if (deleted === 0) break;

			// Re-check size periodically
			if (result.tuDeleted % 100_000 === 0) {
				const currentMb = await getD1SizeMb(env);
				if (currentMb >= 0 && currentMb < D1_SIZE_THRESHOLD_MB * 0.7) break; // Stop at 70% of threshold
			}

			await new Promise(resolve => setTimeout(resolve, 50));
		}

		// Delete oldest vehicle positions
		while (true) {
			const res = await env.DB.prepare(
				`DELETE FROM vp_points WHERE rowid IN (SELECT rowid FROM vp_points ORDER BY ts_ms ASC LIMIT ?)`
			).bind(BATCH_DELETE_LIMIT).run();

			const deleted = res.meta.changes || 0;
			result.vpDeleted += deleted;
			if (deleted === 0) break;

			if (result.vpDeleted % 100_000 === 0) {
				const currentMb = await getD1SizeMb(env);
				if (currentMb >= 0 && currentMb < D1_SIZE_THRESHOLD_MB * 0.7) break;
			}

			await new Promise(resolve => setTimeout(resolve, 50));
		}

		// Delete oldest snapshots
		while (true) {
			const res = await env.DB.prepare(
				`DELETE FROM gtfsrt_snapshots WHERE rowid IN (SELECT rowid FROM gtfsrt_snapshots ORDER BY ts_ms ASC LIMIT ?)`
			).bind(1000).run();

			const deleted = res.meta.changes || 0;
			result.snapshotsDeleted += deleted;
			if (deleted === 0) break;

			await new Promise(resolve => setTimeout(resolve, 50));
		}
	} catch (error) {
		console.error('Error during D1 cleanup:', error);
	}

	console.log(
		`🧹 Cleanup done: removed ${result.tuDeleted} trip updates, ${result.vpDeleted} vehicle positions, ${result.snapshotsDeleted} snapshots`
	);

	return result;
}

export async function getD1SizeMb(env: Env): Promise<number> {
	if (!env.DB) return 0;
	try {
		const result = await env.DB.prepare('SELECT 1').run();
		const sizeAfter = (result.meta as Record<string, unknown>).size_after;
		if (typeof sizeAfter === 'number') {
			return Math.round(sizeAfter / (1024 * 1024));
		}
		return -1;
	} catch {
		return -1;
	}
}
