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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/api/')) {
			switch (url.pathname) {
				case '/api/message':
					return new Response('Hello, World!');
				case '/api/random':
					return new Response(crypto.randomUUID());
				default:
					return new Response('Not Found', { status: 404 });
			}
		}

		// Serve static assets (React build output) from the bound ASSETS fetcher.
		const assetResponse = await env.ASSETS.fetch(request);
		if (assetResponse.status !== 404) return assetResponse;

		// SPA fallback: if the browser requests an unknown path, serve index.html
		// so client-side routing can handle it.
		const accept = request.headers.get('accept') ?? '';
		const isBrowserNavigation = request.method === 'GET' && accept.includes('text/html');
		if (!isBrowserNavigation) return assetResponse;

		const indexUrl = new URL('/index.html', url);
		return env.ASSETS.fetch(new Request(indexUrl, request));
	},
} satisfies ExportedHandler<Env>;
