/**
 * Converts a zoned datetime string (e.g. "2024-03-10T12:00:00") to a UTC
 * millisecond timestamp using Intl.DateTimeFormat to read back the UTC offset
 * for the given IANA timezone. This avoids pulling in a full tz library.
 *
 * We anchor at noon local time to avoid DST ambiguity:
 * - Spring-forward removes 02:00, which is 10h from noon — safe.
 * - Fall-back duplicates 01:00-02:00, which is 10-11h from noon — safe.
 */
export function zonedDateTimeToUtcMs(isoLocalStr: string, tz: string): number {
  // Parse the naive local date components out of the ISO string.
  const [datePart, timePart] = isoLocalStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);

  // Build a UTC Date that represents the same wall-clock instant in the given
  // timezone by using a formatting trick: format a known UTC epoch through the
  // target tz, compare the output to what we want, and offset accordingly.
  //
  // We use a two-step binary approach: first build a UTC date assuming the
  // civil time IS UTC, then read back the tz offset at that approximation and
  // correct it. One iteration is sufficient because tz offsets only shift by
  // ±1h at most, and we are anchored at noon so the corrected time is still
  // within the same tz-offset regime (DST transitions never happen at noon).
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  function readOffset(utcMs: number): number {
    const p = fmt.formatToParts(new Date(utcMs));
    const g = (t: string) => Number(p.find(x => x.type === t)?.value ?? '0');
    let h = g('hour');
    if (h === 24) h = 0;
    const interp = Date.UTC(g('year'), g('month') - 1, g('day'), h, g('minute'), g('second'));
    return utcMs - interp;
  }

  // Pass 1: estimate using naive UTC.
  const offset1 = readOffset(naiveUtcMs);
  const candidate1 = naiveUtcMs + offset1;

  // Pass 2: re-read offset at the corrected candidate. If the candidate crossed a
  // DST boundary the offset will differ; applying it converges to the correct UTC.
  const offset2 = readOffset(candidate1);
  return naiveUtcMs + offset2;
}

/**
 * Converts a GTFS static HH:MM:SS arrival_time (which may exceed 24h for
 * trips that start before midnight and run past midnight) into a UTC epoch
 * millisecond value, given the agency timezone and the service start_date
 * ('YYYYMMDD' from TripDescriptor).
 *
 * Algorithm (per plan §1a):
 *   1. Anchor at "noon local" on start_date — this is DST-safe.
 *   2. Add (totalSeconds – 12h) to the anchor.
 */
export function scheduledArrivalMs(tz: string, startDate: string, arrival: string): number {
  const [hStr, mStr, sStr] = arrival.split(':');
  const totalSeconds = Number(hStr) * 3600 + Number(mStr) * 60 + Number(sStr);

  const yyyy = startDate.slice(0, 4);
  const mm = startDate.slice(4, 6);
  const dd = startDate.slice(6, 8);

  const noonLocalMs = zonedDateTimeToUtcMs(`${yyyy}-${mm}-${dd}T12:00:00`, tz);
  return noonLocalMs + (totalSeconds - 12 * 3600) * 1000;
}

/**
 * Returns the local civil date (YYYYMMDD) of a UTC millisecond timestamp in
 * the given IANA timezone. Used by the backfill to infer start_date from ts_ms.
 */
export function utcMsToLocalDate(tsMs: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA gives YYYY-MM-DD
  return fmt.format(new Date(tsMs)).replace(/-/g, '');
}

/**
 * Decomposes a (start_ms, end_ms, dowSubset, hourRange) filter into an array
 * of UTC [since_ms, until_ms] sub-windows that cover only the requested
 * local-time cells. Handles DST naturally (each civil day is walked
 * independently using Intl).
 *
 * @param startMs     Overall window start (inclusive), UTC ms
 * @param endMs       Overall window end (exclusive), UTC ms
 * @param tz          IANA timezone string
 * @param dowSubset   Set of day-of-week numbers (0=Sun … 6=Sat) to include,
 *                    or null/empty to include all days.
 * @param hourStart   First hour to include (0-23, local), inclusive
 * @param hourEnd     Last hour to include (0-23, local), exclusive (use 24 for EOD)
 * @param maxWindows  Hard cap on the number of sub-windows returned; if the
 *                    decomposition would exceed this, returns null (caller
 *                    falls back to rollup path).
 */
export function decomposeToUtcWindows(
  startMs: number,
  endMs: number,
  tz: string,
  dowSubset: number[] | null,
  hourStart: number,
  hourEnd: number,
  maxWindows = 50,
): Array<[number, number]> | null {
  const windows: Array<[number, number]> = [];

  // If no dow/hour filter, return single window.
  const hasFilter = (dowSubset && dowSubset.length > 0 && dowSubset.length < 7) ||
    hourStart > 0 || hourEnd < 24;
  if (!hasFilter) return [[startMs, endMs]];

  const dowSet = dowSubset && dowSubset.length > 0 ? new Set(dowSubset) : null;

  // Walk civil days in the timezone.
  // Start at the beginning of the local day that contains startMs.
  const startLocalDate = utcMsToLocalDate(startMs, tz);
  const yyyy = Number(startLocalDate.slice(0, 4));
  const mm = Number(startLocalDate.slice(4, 6)) - 1;
  const dd = Number(startLocalDate.slice(6, 8));

  // Anchor: midnight local = noon - 12h
  let dayNoonMs = zonedDateTimeToUtcMs(
    `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}T12:00:00`,
    tz,
  );

  let iterations = 0;
  const maxDays = 400; // safety cap

  while (iterations++ < maxDays) {
    const midnightMs = dayNoonMs - 12 * 3600 * 1000;

    // If the start of this day is already past endMs, we're done.
    if (midnightMs >= endMs) break;

    // Determine local DOW at this day's noon (stable anchor).
    const dowNum = new Date(dayNoonMs).getDay(); // getDay() is UTC-based; use Intl instead
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const weekdayStr = fmt.format(new Date(dayNoonMs));
    const localDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayStr);

    void dowNum; // suppress unused warning

    if (!dowSet || dowSet.has(localDow)) {
      // Compute the UTC ms for hourStart and hourEnd on this local day.
      const localDate = utcMsToLocalDate(dayNoonMs, tz);
      const ly = localDate.slice(0, 4);
      const lm = localDate.slice(4, 6);
      const ld = localDate.slice(6, 8);

      const windowStart = Math.max(
        startMs,
        zonedDateTimeToUtcMs(`${ly}-${lm}-${ld}T${String(hourStart).padStart(2, '0')}:00:00`, tz),
      );
      const rawEnd = hourEnd >= 24
        ? dayNoonMs + 12 * 3600 * 1000  // next day's midnight
        : zonedDateTimeToUtcMs(`${ly}-${lm}-${ld}T${String(hourEnd).padStart(2, '0')}:00:00`, tz);
      const windowEnd = Math.min(endMs, rawEnd);

      if (windowStart < windowEnd) {
        windows.push([windowStart, windowEnd]);
        if (windows.length > maxWindows) return null;
      }
    }

    // Advance to next civil day: jump ~24h from noon and re-anchor.
    dayNoonMs += 25 * 3600 * 1000; // overshoot slightly
    const nextDate = utcMsToLocalDate(dayNoonMs, tz);
    const ny = nextDate.slice(0, 4);
    const nm = nextDate.slice(4, 6);
    const nd = nextDate.slice(6, 8);
    dayNoonMs = zonedDateTimeToUtcMs(`${ny}-${nm}-${nd}T12:00:00`, tz);
  }

  return windows;
}
