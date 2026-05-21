// FastAdmin password hashing helpers (md5(md5(password) + salt)).
import crypto from 'node:crypto'

export function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

/** Compute the FastAdmin admin/user password hash. */
export function fastadminHash(password: string, salt: string): string {
  return md5(md5(password) + salt)
}
