import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Hello World user worker', () => {
  describe('request for /api/health/message', () => {
    it('/ responds with "Hello, World!" (unit style)', async () => {
      const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/health/message');
      // Create an empty context to pass to `worker.fetch()`.
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
      await waitOnExecutionContext(ctx);
      expect(await response.text()).toMatchInlineSnapshot(`"Hello, World!"`);
    });

    it('responds with "Hello, World!" (integration style)', async () => {
      const request = new Request('http://example.com/api/health/message');
      const response = await SELF.fetch(request);
      expect(await response.text()).toMatchInlineSnapshot(`"Hello, World!"`);
    });
  });

  describe('request for /api/health/random', () => {
    it('/ responds with a random UUID (unit style)', async () => {
      const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/health/random');
      // Create an empty context to pass to `worker.fetch()`.
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
      await waitOnExecutionContext(ctx);
      expect(await response.text()).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
    });

    it('responds with a random UUID (integration style)', async () => {
      const request = new Request('http://example.com/api/health/random');
      const response = await SELF.fetch(request);
      expect(await response.text()).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
    });
  });

  describe('request for /api/metadata/agencies', () => {
    it('responds with agencies from D1 (integration style)', async () => {
      const request = new Request('http://example.com/api/metadata/agencies');
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { agencies: Array<{ agency_id: string }> };
      expect(json.agencies.length).toBeGreaterThan(0);
      expect(json.agencies.some((a) => a.agency_id === 'mta-maryland-local-bus')).toBe(true);
    });
  });

  describe('request for /api/metadata/agency/{agency_id}/feeds', () => {
    it('responds with feeds for an agency (integration style)', async () => {
      const request = new Request('http://example.com/api/metadata/agency/mta-maryland-local-bus/feeds');
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { feeds: Array<{ agency_id: string; feed_type: string }> };
      expect(json.feeds.length).toBeGreaterThan(0);
      expect(json.feeds.every((f) => f.agency_id === 'mta-maryland-local-bus')).toBe(true);
    });
  });

  describe('request for /api/gtfs-static/fetch', () => {
    it('fetches and stores a GTFS static version (integration style)', async () => {
      const request = new Request('http://example.com/api/gtfs-static/fetch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agency_id: 'mta-maryland-local-bus' }),
      });
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { gtfs_version_id: string; r2_key: string };
      expect(json.gtfs_version_id).toMatch(/^[a-f0-9]{64}$/);
      expect(json.r2_key).toContain('gtfs-static/mta-maryland-local-bus/');
    });
  });

  describe('request for /api/gtfs-static/agency/{agency_id}/versions', () => {
    it('responds with known GTFS static versions (integration style)', async () => {
      const request = new Request('http://example.com/api/gtfs-static/agency/mta-maryland-local-bus/versions');
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { versions: Array<{ gtfs_version_id: string; agency_id: string }> };
      expect(json.versions.length).toBeGreaterThan(0);
      expect(json.versions.every((v) => v.agency_id === 'mta-maryland-local-bus')).toBe(true);
    });
  });

  describe('request for /api/gtfs-static/agency/{agency_id}/version-at', () => {
    it('responds with effective GTFS static version (integration style)', async () => {
      const request = new Request(
        'http://example.com/api/gtfs-static/agency/mta-maryland-local-bus/version-at?ts_ms=1735689600000'
      );
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { gtfs_version_id: string; effective_from_ms: number };
      expect(json.gtfs_version_id).toBe('demo-gtfs-version-id');
      expect(json.effective_from_ms).toBe(1735689600000);
    });
  });

  describe('request for /api/ingest/run', () => {
    it('invokes Durable Object ingest run (integration style)', async () => {
      const request = new Request('http://example.com/api/ingest/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agency_id: 'mta-maryland-local-bus' }),
      });
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { ok: boolean; ts_ms: number };
      expect(json.ok).toBe(true);
      expect(typeof json.ts_ms).toBe('number');
    });
  });

  describe('request for /api/exports/agency/{agency_id}/manifest', () => {
    it('responds with an export manifest (integration style)', async () => {
      const request = new Request(
        'http://example.com/api/exports/agency/mta-maryland-local-bus/manifest?date=2025-01-01&feed_type=vehicle-positions&format=pb'
      );
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { agency_id: string; objects: unknown[] };
      expect(json.agency_id).toBe('mta-maryland-local-bus');
      expect(Array.isArray(json.objects)).toBe(true);
    });
  });

  describe('request for /api/exports/agency/{agency_id}/snapshots', () => {
    it('responds with snapshots list (integration style)', async () => {
      const request = new Request(
        'http://example.com/api/exports/agency/mta-maryland-local-bus/snapshots?feed_type=vehicle-positions&limit=10'
      );
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);

      const json = (await response.json()) as { snapshots: unknown[] };
      expect(Array.isArray(json.snapshots)).toBe(true);
    });
  });
});
