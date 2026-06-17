const dayFormatterCache = new Map();
const zonedDayStartCache = new Map();

export function createDayKeyFormatter(tz) {
  const formatter = getDayFormatter(tz);

  return (ms) => {
    const parts = formatter.formatToParts(new Date(ms));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  };
}

export function addDaysToDayKey(dayKey, days) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function getZonedDayStartMs(dayKey, tz) {
  const cacheKey = `${tz}\0${dayKey}`;
  if (zonedDayStartCache.has(cacheKey)) return zonedDayStartCache.get(cacheKey);

  const toDayKey = createDayKeyFormatter(tz);
  const guess = Date.parse(`${dayKey}T00:00:00Z`);
  let low = guess - 36 * 60 * 60 * 1000;
  let high = guess + 36 * 60 * 60 * 1000;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (toDayKey(mid) < dayKey) low = mid + 1;
    else high = mid;
  }

  zonedDayStartCache.set(cacheKey, low);
  return low;
}

export function splitIntervalByDay(startMs, endMs, tz) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const toDayKey = createDayKeyFormatter(tz);
  const result = [];
  let cursor = startMs;
  let dayKey = toDayKey(cursor);

  while (cursor < endMs) {
    const nextDayStart = getZonedDayStartMs(addDaysToDayKey(dayKey, 1), tz);
    const overlapEnd = Math.min(endMs, nextDayStart);
    if (overlapEnd > cursor) {
      result.push({ dayKey, overlapMs: overlapEnd - cursor });
      cursor = overlapEnd;
    } else {
      cursor = Math.min(endMs, cursor + 1);
    }
    dayKey = toDayKey(cursor);
  }

  return result;
}

function getDayFormatter(tz) {
  if (!dayFormatterCache.has(tz)) {
    dayFormatterCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }));
  }
  return dayFormatterCache.get(tz);
}
