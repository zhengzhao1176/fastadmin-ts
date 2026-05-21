// Self-test for the cron matcher. Run:
//   node --import=@swc-node/register/esm-register scripts/cron-matcher.selftest.ts
// Exits 0 if every assertion passes, 1 (with a diff) otherwise.
import { cronMatches } from '../src/common/cron-matcher.ts'

let pass = 0
let fail = 0

/** Build a Date with the given minute/hour/day/month(1-12)/weekday is derived. */
function at(min: number, hour = 0, day = 15, month = 6): Date {
  // month is 1-based here; JS Date wants 0-based.
  return new Date(2026, month - 1, day, hour, min, 0, 0)
}

function check(label: string, got: boolean, want: boolean): void {
  if (got === want) {
    pass++
  } else {
    fail++
    // eslint-disable-next-line no-console
    console.error(`  FAIL: ${label} — got ${got}, want ${want}`)
  }
}

// ---- `*/5` step on the minute field ----
check('*/5 matches minute 0', cronMatches('*/5 * * * *', at(0)), true)
check('*/5 matches minute 5', cronMatches('*/5 * * * *', at(5)), true)
check('*/5 matches minute 10', cronMatches('*/5 * * * *', at(10)), true)
check('*/5 does NOT match minute 11', cronMatches('*/5 * * * *', at(11)), false)
check('*/5 does NOT match minute 7', cronMatches('*/5 * * * *', at(7)), false)
check('*/5 matches minute 55', cronMatches('*/5 * * * *', at(55)), true)

// ---- wildcard ----
check('* * * * * matches anything', cronMatches('* * * * *', at(37, 13)), true)

// ---- exact minute ----
check('30 * * * * matches minute 30', cronMatches('30 * * * *', at(30)), true)
check('30 * * * * does NOT match minute 31', cronMatches('30 * * * *', at(31)), false)

// ---- list `a,b` ----
check('0,15,30,45 matches minute 15', cronMatches('0,15,30,45 * * * *', at(15)), true)
check('0,15,30,45 matches minute 45', cronMatches('0,15,30,45 * * * *', at(45)), true)
check('0,15,30,45 does NOT match minute 20', cronMatches('0,15,30,45 * * * *', at(20)), false)

// ---- range `a-b` ----
check('10-20 matches minute 15', cronMatches('10-20 * * * *', at(15)), true)
check('10-20 matches boundary minute 10', cronMatches('10-20 * * * *', at(10)), true)
check('10-20 matches boundary minute 20', cronMatches('10-20 * * * *', at(20)), true)
check('10-20 does NOT match minute 21', cronMatches('10-20 * * * *', at(21)), false)
check('10-20 does NOT match minute 9', cronMatches('10-20 * * * *', at(9)), false)

// ---- hour field ----
check('0 9 * * * matches 09:00', cronMatches('0 9 * * *', at(0, 9)), true)
check('0 9 * * * does NOT match 10:00', cronMatches('0 9 * * *', at(0, 10)), false)
check('0 9 * * * does NOT match 09:30', cronMatches('0 9 * * *', at(30, 9)), false)

// ---- day-of-month + month ----
// 2026-06-15 is a Monday.
check('0 0 15 6 * matches Jun 15 00:00', cronMatches('0 0 15 6 *', at(0, 0, 15, 6)), true)
check('0 0 15 6 * does NOT match Jun 16', cronMatches('0 0 15 6 *', at(0, 0, 16, 6)), false)
check('0 0 15 7 * does NOT match Jun 15', cronMatches('0 0 15 7 *', at(0, 0, 15, 6)), false)

// ---- weekday (0 = Sunday); 2026-06-15 is Monday (1) ----
check('* * * * 1 matches Monday', cronMatches('* * * * 1', at(0, 0, 15, 6)), true)
check('* * * * 0 does NOT match Monday', cronMatches('* * * * 0', at(0, 0, 15, 6)), false)
check('* * * * 1-5 matches Monday (weekday range)', cronMatches('* * * * 1-5', at(0, 0, 15, 6)), true)

// ---- combined list with step + range ----
check('1,2,10-12,*/30 matches minute 0 (via */30)', cronMatches('1,2,10-12,*/30 * * * *', at(0)), true)
check('1,2,10-12,*/30 matches minute 11 (via range)', cronMatches('1,2,10-12,*/30 * * * *', at(11)), true)
check('1,2,10-12,*/30 matches minute 2 (via list)', cronMatches('1,2,10-12,*/30 * * * *', at(2)), true)
check('1,2,10-12,*/30 does NOT match minute 5', cronMatches('1,2,10-12,*/30 * * * *', at(5)), false)

// ---- malformed expressions return false, never throw ----
check('empty string → false', cronMatches('', at(0)), false)
check('too few fields → false', cronMatches('* * *', at(0)), false)
check('too many fields → false', cronMatches('* * * * * *', at(0)), false)

// eslint-disable-next-line no-console
console.log(`cron-matcher self-test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
