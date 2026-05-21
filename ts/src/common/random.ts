// Ports PHP `\fast\Random` (doc 1264 辅助类) — random string / uuid generation.
// Uses `node:crypto` for the randomness source so values are cryptographically
// sound (PHP's `str_shuffle`/`mt_rand` are not, but the observable behaviour —
// charset, length, format — is identical).
import crypto from 'node:crypto'

const POOLS: Record<string, string> = {
  alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alnum: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numeric: '0123456789',
  nozero: '123456789',
}

/** Crypto-strong Fisher-Yates shuffle of a string. */
function shuffle(s: string): string {
  const arr = s.split('')
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr.join('')
}

/**
 * `\fast\Random::build()` — generate a random string.
 * @param type alpha | alnum | numeric | nozero | unique | md5 | encrypt | sha1
 * @param len  length (ignored for the hash types)
 */
export function build(type = 'alnum', len = 8): string {
  if (type in POOLS) {
    const pool = POOLS[type]!
    const repeated = pool.repeat(Math.ceil(len / pool.length))
    return shuffle(repeated).slice(0, Math.max(0, len))
  }
  if (type === 'unique' || type === 'md5') {
    return crypto.createHash('md5').update(crypto.randomBytes(16)).digest('hex')
  }
  if (type === 'encrypt' || type === 'sha1') {
    return crypto.createHash('sha1').update(crypto.randomBytes(20)).digest('hex')
  }
  return ''
}

/** Random digits + letters. */
export function alnum(len = 6): string {
  return build('alnum', len)
}

/** Random letters only. */
export function alpha(len = 6): string {
  return build('alpha', len)
}

/** Random digits. */
export function numeric(len = 4): string {
  return build('numeric', len)
}

/** Random digits with no zero. */
export function nozero(len = 4): string {
  return build('nozero', len)
}

/** RFC-4122 v4 UUID, e.g. `3f2504e0-4f89-41d3-9a0c-0305e82c3301`. */
export function uuid(): string {
  return crypto.randomUUID()
}

/** OOP-style facade matching PHP's `\fast\Random` static class. */
export const Random = { build, alnum, alpha, numeric, nozero, uuid }
