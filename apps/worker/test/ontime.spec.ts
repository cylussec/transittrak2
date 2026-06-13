import { describe, it, expect } from 'vitest';
import {
  scheduledArrivalMs,
  zonedDateTimeToUtcMs,
  utcMsToLocalDate,
  decomposeToUtcWindows,
} from '../src/gtfs-rt/schedule-time';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src';

// ---------------------------------------------------------------------------
// scheduledArrivalMs / zonedDateTimeToUtcMs
// ---------------------------------------------------------------------------

describe('zonedDateTimeToUtcMs', () => {
  it('converts a standard local time to UTC correctly (America/New_York, EST = UTC-5)', () => {
    // 2024-01-15 12:00:00 EST = 2024-01-15 17:00:00 UTC
    const ms = zonedDateTimeToUtcMs('2024-01-15T12:00:00', 'America/New_York');
    const expected = Date.UTC(2024, 0, 15, 17, 0, 0);
    expect(ms).toBe(expected);
  });

  it('converts a standard local time to UTC correctly (America/New_York, EDT = UTC-4)', () => {
    // 2024-07-15 12:00:00 EDT = 2024-07-15 16:00:00 UTC
    const ms = zonedDateTimeToUtcMs('2024-07-15T12:00:00', 'America/New_York');
    const expected = Date.UTC(2024, 6, 15, 16, 0, 0);
    expect(ms).toBe(expected);
  });

  it('handles UTC timezone', () => {
    const ms = zonedDateTimeToUtcMs('2024-03-10T08:30:00', 'UTC');
    expect(ms).toBe(Date.UTC(2024, 2, 10, 8, 30, 0));
  });
});

describe('scheduledArrivalMs', () => {
  it('converts a normal HH:MM:SS arrival to UTC ms', () => {
    // Trip starts 2024-01-15, arrival at 08:30:00 EST (UTC-5)
    // => 2024-01-15 13:30:00 UTC
    const ms = scheduledArrivalMs('America/New_York', '20240115', '08:30:00');
    const expected = Date.UTC(2024, 0, 15, 13, 30, 0);
    expect(ms).toBe(expected);
  });

  it('handles arrival_time > 24h (next-day trips)', () => {
    // arrival_time = "25:13:00" means 25h 13m into start_date = next calendar day at 01:13
    // start_date = 20240115, tz = America/New_York (EST = UTC-5)
    // local 2024-01-16 01:13:00 EST => UTC 2024-01-16 06:13:00
    const ms = scheduledArrivalMs('America/New_York', '20240115', '25:13:00');
    const expected = Date.UTC(2024, 0, 16, 6, 13, 0);
    expect(ms).toBe(expected);
  });

  it('handles arrival_time exactly at midnight (24:00:00)', () => {
    // 24:00:00 = end of day = start of next day midnight
    // 2024-01-15 + 24h = 2024-01-16 00:00 EST = 2024-01-16 05:00 UTC
    const ms = scheduledArrivalMs('America/New_York', '20240115', '24:00:00');
    const expected = Date.UTC(2024, 0, 16, 5, 0, 0);
    expect(ms).toBe(expected);
  });

  it('DST spring-forward: 2024-03-10 America/New_York — 9am is EDT not EST', () => {
    // Spring-forward happens at 2am local, so by 9am clocks are already on EDT (UTC-4).
    // 2024-03-10 09:00 EDT = 13:00 UTC
    const ms = scheduledArrivalMs('America/New_York', '20240310', '09:00:00');
    const expected = Date.UTC(2024, 2, 10, 13, 0, 0);
    expect(ms).toBe(expected);
  });

  it('DST spring-forward: afternoon after transition (EDT = UTC-4)', () => {
    // arrival at 14:00:00 on 2024-03-10 (EDT, clocks already sprung)
    // 2024-03-10 14:00 EDT = 18:00 UTC
    const ms = scheduledArrivalMs('America/New_York', '20240310', '14:00:00');
    const expected = Date.UTC(2024, 2, 10, 18, 0, 0);
    expect(ms).toBe(expected);
  });

  it('DST fall-back: 2024-11-03 America/New_York — noon anchor is unambiguous', () => {
    // Noon on 2024-11-03 in New York has already fallen back to EST.
    // Noon EST = UTC-5 = 17:00 UTC.
    // scheduledArrivalMs uses noon anchor: noonLocalMs + (totalSec - 12h).
    // For '12:00:00': delta=0, so we get exactly noon UTC-correct = 17:00 UTC.
    const ms = scheduledArrivalMs('America/New_York', '20241103', '12:00:00');
    const expected = Date.UTC(2024, 10, 3, 17, 0, 0); // noon EST
    expect(ms).toBe(expected);
  });

  it('DST fall-back: afternoon arrival is correctly offset from noon anchor', () => {
    // 14:00 on 2024-11-03 = 2h after noon EST = 19:00 UTC
    const ms = scheduledArrivalMs('America/New_York', '20241103', '14:00:00');
    const expected = Date.UTC(2024, 10, 3, 19, 0, 0);
    expect(ms).toBe(expected);
  });
});

describe('utcMsToLocalDate', () => {
  it('returns YYYYMMDD for a UTC ms in Eastern time', () => {
    // 2024-01-15 23:00:00 UTC = 2024-01-15 18:00 EST => still Jan 15
    const ms = Date.UTC(2024, 0, 15, 23, 0, 0);
    expect(utcMsToLocalDate(ms, 'America/New_York')).toBe('20240115');
  });

  it('rolls to next local day after midnight', () => {
    // 2024-01-16 04:00:00 UTC = 2024-01-15 23:00 EST => still Jan 15... wait no:
    // EST = UTC-5, so UTC 04:00 = local 23:00 on Jan 15. Yes, still Jan 15.
    const ms = Date.UTC(2024, 0, 16, 4, 0, 0); // UTC Jan 16 04:00 = EST Jan 15 23:00
    expect(utcMsToLocalDate(ms, 'America/New_York')).toBe('20240115');
  });

  it('crosses midnight correctly', () => {
    // UTC 2024-01-16 06:00 = EST 2024-01-16 01:00 => Jan 16
    const ms = Date.UTC(2024, 0, 16, 6, 0, 0);
    expect(utcMsToLocalDate(ms, 'America/New_York')).toBe('20240116');
  });
});

// ---------------------------------------------------------------------------
// decomposeToUtcWindows
// ---------------------------------------------------------------------------

describe('decomposeToUtcWindows', () => {
  it('returns single window when no dow/hour filter applied', () => {
    const start = Date.UTC(2024, 0, 15, 0, 0, 0);
    const end = Date.UTC(2024, 0, 17, 0, 0, 0);
    const windows = decomposeToUtcWindows(start, end, 'America/New_York', null, 0, 24);
    expect(windows).toEqual([[start, end]]);
  });

  it('filters weekends only (sat=6, sun=0) from a weekday range', () => {
    // 2024-01-15 Mon through 2024-01-21 Sun
    const start = Date.UTC(2024, 0, 15, 5, 0, 0); // Mon 00:00 EST
    const end = Date.UTC(2024, 0, 22, 5, 0, 0);   // Mon 00:00 EST following week
    const windows = decomposeToUtcWindows(start, end, 'America/New_York', [0, 6], 0, 24);
    expect(windows).not.toBeNull();
    // Should have 2 windows: Sat Jan 20 and Sun Jan 21
    expect(windows!.length).toBe(2);
  });

  it('filters weekday rush hour (7-9) from a 7-day range', () => {
    // 2024-01-15 Mon through 2024-01-22 Mon (7 days)
    const start = Date.UTC(2024, 0, 15, 5, 0, 0); // Mon 00:00 EST
    const end = Date.UTC(2024, 0, 22, 5, 0, 0);
    // Mon-Fri, 7-9
    const windows = decomposeToUtcWindows(start, end, 'America/New_York', [1, 2, 3, 4, 5], 7, 9);
    expect(windows).not.toBeNull();
    // 5 weekday windows, each 2h
    expect(windows!.length).toBe(5);
    // Each window should be exactly 2h wide
    for (const [s, e] of windows!) {
      expect(e - s).toBe(2 * 3600 * 1000);
    }
  });

  it('returns null when maxWindows would be exceeded', () => {
    // 3-month range with weekday-only + hour filter → >50 days
    const start = Date.UTC(2024, 0, 1, 0, 0, 0);
    const end = Date.UTC(2024, 3, 1, 0, 0, 0); // ~91 days
    const windows = decomposeToUtcWindows(start, end, 'America/New_York', [1, 2, 3, 4, 5], 7, 9, 50);
    expect(windows).toBeNull();
  });

  it('DST spring-forward: single day window passthrough is correct', () => {
    // 2024-03-10 is a Sunday in America/New_York (spring-forward day).
    const start = Date.UTC(2024, 2, 10, 5, 0, 0); // midnight EST = 05:00 UTC
    const end = Date.UTC(2024, 2, 11, 4, 0, 0);   // midnight EDT = 04:00 UTC next day

    // No filter → single window passthrough
    const windows = decomposeToUtcWindows(start, end, 'America/New_York', null, 0, 24);
    expect(windows).toEqual([[start, end]]);

    // Sunday-only DOW filter on this Sunday: 1 window
    const sunWindows = decomposeToUtcWindows(start, end, 'America/New_York', [0], 0, 24);
    expect(sunWindows).not.toBeNull();
    expect(sunWindows!.length).toBe(1);

    // Hour filter 9-17 (all safely in EDT, post-transition)
    // 9am EDT = 13:00 UTC; 5pm EDT = 21:00 UTC → 8h window
    const hourWindows = decomposeToUtcWindows(start, end, 'America/New_York', null, 9, 17);
    expect(hourWindows).not.toBeNull();
    expect(hourWindows!.length).toBe(1);
    const [ws, we] = hourWindows![0];
    expect(we - ws).toBe(8 * 3600 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Backfill dry-run integration test
// ---------------------------------------------------------------------------

describe('POST /api/admin/backfill-delays dry-run', () => {
  it('returns 401 without auth token', async () => {
    const req = new Request<unknown, IncomingRequestCfProperties>(
      'http://example.com/api/admin/backfill-delays?agency_id=mta-maryland&dry_run=true',
      { method: 'POST' }
    );
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it('returns dry-run result with correct shape when authed', async () => {
    const req = new Request<unknown, IncomingRequestCfProperties>(
      'http://example.com/api/admin/backfill-delays?agency_id=mta-maryland&dry_run=true',
      {
        method: 'POST',
        headers: { 'X-Admin-Token': 'test-admin-token' },
      }
    );
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      dry_run: boolean;
      processed: number;
      updated: number;
      skipped: number;
      done: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.dry_run).toBe(true);
    expect(typeof json.processed).toBe('number');
    expect(typeof json.updated).toBe('number');
    expect(typeof json.skipped).toBe('number');
    expect(typeof json.done).toBe('boolean');
  });
});
