// FastAdmin password hash: md5(md5(password) + salt). Must match
// scripts/hash.ts so seeded users authenticate via the TS port.
import crypto from 'node:crypto'

export function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

export function fastadminHash(password: string, salt: string): string {
  return md5(md5(password) + salt)
}

export function randomToken(): string {
  // UUID v4-ish; PHP uses Random::uuid() which is mt_rand based. Node's
  // randomUUID is cryptographically random — strictly better than the PHP
  // version (no collisions in practice).
  return crypto.randomUUID()
}

export function randomSalt(len = 4): string {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len)
}
