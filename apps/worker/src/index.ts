import { Hono } from 'hono';
import { registerRoutes } from './routes';
import { handleParseQueue, type ParseJob } from './queues/parse-queue';
import { fetchGtfsStatic } from './gtfs-static/fetch';
import { parseAndStoreGtfsStatic } from './gtfs-static/parsers';
import { cleanupD1HotCache } from './cleanup/retention';

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

registerRoutes(api);

app.route('/api', api);

const serveAssets = async (request: Request, env: Env): Promise<Response> => {
	const assetResponse = await env.ASSETS.fetch(request);
	if (assetResponse.status !== 404) return assetResponse;

	if (request.method === 'GET') {
		const accept = request.headers.get('accept') ?? '';
		const isBrowserNavigation = accept.includes('text/html');
		if (isBrowserNavigation) {
			const url = new URL(request.url);
			const indexUrl = new URL('/index.html', url);
			return env.ASSETS.fetch(new Request(indexUrl, request));
		}
	}

	return assetResponse;
};

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const response = await app.fetch(request, env, ctx);
		if (response.status === 404) {
			const url = new URL(request.url);
			if (!url.pathname.startsWith('/api/')) {
				return serveAssets(request, env);
			}
		}

		return response;
	},
	async scheduled(controller, env, ctx): Promise<void> {
		if (!env.DB) return;
		if (!env.INGEST_COORDINATOR) return;

		const currentHour = new Date().getUTCHours();
		const isDailySchedule = controller.cron === '0 2 * * *' || currentHour === 2;

		try {
			const agencies = await env.DB.prepare('SELECT agency_id FROM agencies WHERE enabled = 1 ORDER BY agency_id').all();
			for (const row of agencies.results ?? []) {
				const agencyId = (row as { agency_id?: unknown }).agency_id;
				if (typeof agencyId !== 'string') continue;

				const id = env.INGEST_COORDINATOR.idFromName(agencyId);
				const stub = env.INGEST_COORDINATOR.get(id);
				ctx.waitUntil(
					stub.fetch('https://do/do/ingest/run', {
						method: 'POST',
						headers: {
							'content-type': 'application/json; charset=utf-8',
						},
						body: JSON.stringify({ agency_id: agencyId }),
					})
				);

				if (isDailySchedule && env.GTFS_STATIC_COORDINATOR) {
					const staticId = env.GTFS_STATIC_COORDINATOR.idFromName(agencyId);
					const staticStub = env.GTFS_STATIC_COORDINATOR.get(staticId);
					ctx.waitUntil(
						staticStub.fetch('https://do/do/gtfs-static/fetch', {
							method: 'POST',
							headers: {
								'content-type': 'application/json; charset=utf-8',
							},
							body: JSON.stringify({ agency_id: agencyId }),
						})
					);
				}
			}

			// Run D1 size-based cleanup once per day at 2am UTC
			if (isDailySchedule) {
				ctx.waitUntil(cleanupD1HotCache(env));
			}
		} catch {
			return;
		}
	},
	async queue(batch, env): Promise<void> {
		await handleParseQueue(batch as MessageBatch<ParseJob>, env);
	},
} satisfies ExportedHandler<Env>;

export class IngestCoordinator {
	private readonly state: DurableObjectState;
	private readonly env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/do/ingest/run') {
			if (!this.env.DB) return new Response('D1 not configured', { status: 501 });
			if (!this.env.ARCHIVE_BUCKET) return new Response('R2 not configured', { status: 501 });
			if (!this.env.SWIFTLY_API_KEY) return new Response('SWIFTLY_API_KEY not configured', { status: 501 });

			const json = (await request.json().catch(() => null)) as null | { agency_id?: unknown };
			const agencyId = typeof json?.agency_id === 'string' ? json.agency_id : null;
			if (!agencyId) return new Response('Invalid agency_id', { status: 400 });

			const feeds = await this.env.DB.prepare(
				'SELECT feed_id, agency_id, feed_type, url, enabled FROM feeds WHERE agency_id = ? AND enabled = 1'
			)
				.bind(agencyId)
				.all<{ feed_id: string; agency_id: string; feed_type: string; url: string; enabled: number }>();

			const tsMs = Date.now();
			const date = new Date(tsMs);
			const year = String(date.getUTCFullYear());
			const month = String(date.getUTCMonth() + 1).padStart(2, '0');
			const day = String(date.getUTCDate()).padStart(2, '0');
			const hour = String(date.getUTCHours()).padStart(2, '0');

			let gtfsVersionId: string | null = null;
			const versionRow = await this.env.DB.prepare(
				'SELECT gtfs_version_id FROM gtfs_version_effective WHERE agency_id = ? AND effective_from_ms <= ? ORDER BY effective_from_ms DESC LIMIT 1'
			)
				.bind(agencyId, tsMs)
				.first<{ gtfs_version_id: string }>();
			if (versionRow?.gtfs_version_id) gtfsVersionId = versionRow.gtfs_version_id;

			const results: Array<{ feed_type: string; status: number; snapshot_id?: string; r2_key?: string }> = [];

			for (const feed of feeds.results ?? []) {
				const feedType = feed.feed_type;
				const snapshotId = `${agencyId}:${feedType}:${tsMs}`;
				const r2Key = `gtfsrt/${agencyId}/${feedType}/year=${year}/month=${month}/day=${day}/hour=${hour}/${tsMs}.pb`;

				const resp = await fetch(feed.url, {
					headers: {
						Authorization: this.env.SWIFTLY_API_KEY || '',
					},
				});

				if (!resp.ok) {
					results.push({ feed_type: feedType, status: resp.status });
					continue;
				}

				const bytes = await resp.arrayBuffer();
				await this.env.ARCHIVE_BUCKET.put(r2Key, bytes, {
					httpMetadata: {
						contentType: 'application/x-protobuf',
					},
					customMetadata: {
						agency_id: agencyId,
						feed_type: feedType,
						ts_ms: String(tsMs),
					},
				});

				try {
					await this.env.DB.prepare(
						'INSERT OR IGNORE INTO gtfsrt_snapshots (snapshot_id, agency_id, feed_type, ts_ms, gtfs_version_id, r2_key, byte_size, http_etag, http_last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).bind(
						snapshotId,
						agencyId,
						feedType,
						tsMs,
						gtfsVersionId,
						r2Key,
						bytes.byteLength,
						resp.headers.get('etag'),
						resp.headers.get('last-modified')
					).run();
				} catch (d1Error) {
					console.error(` D1 snapshot insert failed (data safe in R2): ${d1Error}`);
				}

				if (this.env.PARSE_QUEUE && gtfsVersionId) {
					await this.env.PARSE_QUEUE.send({
						snapshotId,
						agencyId,
						feedType,
						r2Key,
						gtfsVersionId,
						tsMs,
					} satisfies ParseJob);
				}

				results.push({ feed_type: feedType, status: 200, snapshot_id: snapshotId, r2_key: r2Key });
			}

			return new Response(JSON.stringify({ ok: true, ts_ms: tsMs, results }), {
				status: 200,
				headers: {
					'content-type': 'application/json; charset=utf-8',
				},
			});
		}

		return new Response('Not Found', { status: 404 });
	}
}

export class GtfsStaticCoordinator {
	private readonly state: DurableObjectState;
	private readonly env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/do/gtfs-static/fetch') {
			if (!this.env.DB) return new Response('D1 not configured', { status: 501 });
			if (!this.env.ARCHIVE_BUCKET) return new Response('R2 not configured', { status: 501 });

			const json = (await request.json().catch(() => null)) as null | { agency_id?: unknown };
			const agencyId = typeof json?.agency_id === 'string' ? json.agency_id : null;
			if (!agencyId) return new Response('Invalid agency_id', { status: 400 });

			const agency = await this.env.DB.prepare(
				'SELECT agency_id, gtfs_static_url FROM agencies WHERE agency_id = ?'
			)
				.bind(agencyId)
				.first<{ agency_id: string; gtfs_static_url: string }>();

			if (!agency) {
				return new Response(JSON.stringify({ error: 'Agency not found' }), {
					status: 404,
					headers: { 'content-type': 'application/json' },
				});
			}

			const result = await fetchGtfsStatic(agencyId, agency.gtfs_static_url, this.env);

			if (!result) {
				return new Response(
					JSON.stringify({ ok: false, message: 'No new GTFS version or fetch failed' }),
					{
						status: 200,
						headers: { 'content-type': 'application/json' },
					}
				);
			}

			try {
				await parseAndStoreGtfsStatic(agencyId, result.gtfsVersionId, result.r2Key, this.env);
			} catch (parseError) {
				console.error(`❌ GTFS static parse failed:`, parseError);
				return new Response(
					JSON.stringify({
						ok: false,
						error: String(parseError),
						gtfs_version_id: result.gtfsVersionId,
					}),
					{
						status: 500,
						headers: { 'content-type': 'application/json' },
					}
				);
			}

			return new Response(
				JSON.stringify({
					ok: true,
					gtfs_version_id: result.gtfsVersionId,
					r2_key: result.r2Key,
					fetched_at_ms: result.fetchedAtMs,
				}),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				}
			);
		}

		return new Response('Not Found', { status: 404 });
	}
}
