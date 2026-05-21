// Minimal 5-field cron matcher (minute hour day month weekday).
//
// Supports per field: `*`, `*/n`, `n`, `a,b,c`, `a-b`, and combinations
// thereof (e.g. `1,2,10-15,*/20`). This is intentionally small — enough for
// FastAdmin's crontab-style scheduled tasks, not a full Vixie-cron clone.
// Unsupported (silently): names like `MON`/`JAN`, `?`, step on a range
// (`a-b/n`), `L`/`W`/`#`.
//
// Kept as a standalone pure function so it can be unit-tested without booting
// Nest (see scripts/cron-matcher.selftest.ts).

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // weekday (0 = Sunday)
]

/** Expand one cron field into the set of integers it matches. */
function expandField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const token = part.trim()
    if (token === '') continue

    // `*` or `*/n`
    if (token === '*') {
      for (let i = min; i <= max; i++) out.add(i)
      continue
    }
    const stepMatch = /^\*\/(\d+)$/.exec(token)
    if (stepMatch) {
      const step = Number(stepMatch[1])
      if (step > 0) for (let i = min; i <= max; i += step) out.add(i)
      continue
    }

    // `a-b`
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token)
    if (rangeMatch) {
      const a = Number(rangeMatch[1])
      const b = Number(rangeMatch[2])
      for (let i = Math.max(a, min); i <= Math.min(b, max); i++) out.add(i)
      continue
    }

    // plain `n`
    const numMatch = /^\d+$/.exec(token)
    if (numMatch) {
      const n = Number(numMatch[0])
      if (n >= min && n <= max) out.add(n)
      continue
    }
    // unknown token — ignored
  }
  return out
}

/**
 * Does `cronExpr` (5 fields) match the given `date` at minute granularity?
 * Returns false for malformed expressions rather than throwing.
 */
export function cronMatches(cronExpr: string, date: Date): boolean {
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1, // JS months are 0-based
    date.getDay(), // 0 = Sunday
  ]

  for (let i = 0; i < 5; i++) {
    const [min, max] = FIELD_RANGES[i]!
    const allowed = expandField(fields[i]!, min, max)
    if (!allowed.has(values[i]!)) return false
  }
  return true
}
