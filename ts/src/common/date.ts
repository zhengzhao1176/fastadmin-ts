// Port of `fast\Date` from extend/fast/Date.php — date/time helpers.
// Covers offset(), span(), human() and unixtime(). Timestamps are unix
// SECONDS (matching PHP), not JS milliseconds.

const YEAR = 31536000
const MONTH = 2592000
const WEEK = 604800
const DAY = 86400
const HOUR = 3600
const MINUTE = 60

/** All span() output keys, in the order PHP subtracts them. */
const SPAN_UNITS: Array<[string, number]> = [
  ['years', YEAR],
  ['months', MONTH],
  ['weeks', WEEK],
  ['days', DAY],
  ['hours', HOUR],
  ['minutes', MINUTE],
  ['seconds', 1],
]

/**
 * Seconds of offset between two IANA timezones (`tz1` relative to `tz2`),
 * evaluated at `now` (defaults to current time). Mirrors PHP
 * `Date::offset($remote, $local)`.
 */
export function offset(tz1: string, tz2: string, now: Date = new Date()): number {
  return tzOffsetSeconds(tz1, now) - tzOffsetSeconds(tz2, now)
}

/** UTC offset (in seconds) of a timezone at a given instant. */
function tzOffsetSeconds(timeZone: string, at: Date): number {
  // Format the same instant in the target zone, then diff against UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((asUTC - at.getTime()) / 1000)
}

/**
 * Break the duration between two unix timestamps into named units.
 * With `unit` naming a single output (e.g. `'minutes'`) returns just that
 * number; otherwise returns an object keyed by the requested units.
 *
 *   span(60, 182, 'minutes,seconds') // { minutes: 2, seconds: 2 }
 *   span(60, 182, 'minutes')         // 2
 */
export function span(
  start: number,
  end: number = Math.floor(Date.now() / 1000),
  output = 'years,months,weeks,days,hours,minutes,seconds',
): Record<string, number> | number {
  const keys = String(output).trim().toLowerCase().split(/[^a-z]+/).filter(Boolean)
  if (keys.length === 0) return {}
  const wanted = new Set(keys)
  const result: Record<string, number> = {}
  let remaining = Math.abs(start - end)
  for (const [name, secs] of SPAN_UNITS) {
    if (!wanted.has(name)) continue
    if (name === 'seconds') {
      result.seconds = remaining
    } else {
      const n = Math.floor(remaining / secs)
      result[name] = n
      remaining -= secs * n
    }
  }
  // Preserve the caller's key order for the single-output shortcut.
  if (keys.length === 1) return result[keys[0]]
  return result
}

/**
 * Relative-time string for a unix timestamp, e.g. "10 seconds ago" or
 * "1 minute after". `local` overrides "now". Matches the wording of PHP
 * `Date::human()` (which goes through the `__()` translator).
 */
export function human(timestamp: number, local?: number): string {
  const nowSecs = local ?? Math.floor(Date.now() / 1000)
  let diff = nowSecs - timestamp
  const tense = diff < 0 ? 'after' : 'ago'
  diff = Math.abs(diff)
  const chunks: Array<[number, string]> = [
    [YEAR, 'year'],
    [MONTH, 'month'],
    [WEEK, 'week'],
    [DAY, 'day'],
    [HOUR, 'hour'],
    [MINUTE, 'minute'],
    [1, 'second'],
  ]
  let name = 'second'
  let count = 0
  for (const [secs, unit] of chunks) {
    name = unit
    count = Math.floor(diff / secs)
    if (count !== 0) break
  }
  const plural = count > 1 ? 's' : ''
  return `${count} ${name}${plural} ${tense}`
}

/** Days in a given month (1-12) of a year. */
export function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * Start-of-period unix timestamp with an optional offset.
 *   unixtime('day')      // today 00:00:00
 *   unixtime('month', -1) // first second of last month
 * `offset` shifts the period (negative = past, positive = future).
 */
export function unixtime(
  type: 'day' | 'week' | 'month' | 'year',
  offset = 0,
  base: Date = new Date(),
): number {
  const year = base.getFullYear()
  const month = base.getMonth() // 0-indexed
  const day = base.getDate()
  let d: Date
  switch (type) {
    case 'day':
      d = new Date(year, month, day + offset, 0, 0, 0, 0)
      break
    case 'week': {
      // PHP's week starts Monday: weekIndex 0 (Sunday) maps back 6 days.
      const weekday = new Date(year, month, day).getDay()
      const backToMonday = weekday === 0 ? 6 : weekday - 1
      d = new Date(year, month, day - backToMonday + offset * 7, 0, 0, 0, 0)
      break
    }
    case 'month':
      d = new Date(year, month + offset, 1, 0, 0, 0, 0)
      break
    case 'year':
      d = new Date(year + offset, 0, 1, 0, 0, 0, 0)
      break
    default:
      d = new Date(year, month, day, 0, 0, 0, 0)
  }
  return Math.floor(d.getTime() / 1000)
}
