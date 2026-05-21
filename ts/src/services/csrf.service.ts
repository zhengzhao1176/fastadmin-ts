import { Injectable } from '@nestjs/common'
import crypto from 'node:crypto'

// Server-side CSRF token store. PHP's ThinkPHP keeps `__token__` in session
// alongside a name (default `__token__`); we mirror by stashing a fresh hex
// token under `session.__token__` whenever a form is rendered, and consume
// it (one-shot) on POST. Once consumed the slot is rotated.
export interface SessionWithToken {
  __token__?: string | undefined
  [k: string]: unknown
}

@Injectable()
export class CsrfService {
  /** Generate-and-store: returns a 32-hex token, sets it on session. */
  issue(session: SessionWithToken): string {
    const token = crypto.randomBytes(16).toString('hex')
    session.__token__ = token
    return token
  }

  /**
   * Validate `submitted` against `session.__token__`. Consumes the slot on
   * success so a token can't be replayed. Returns true if matched.
   */
  consume(session: SessionWithToken, submitted: string): boolean {
    const expected = session.__token__
    if (!expected || !submitted) return false
    const ok = constantTimeEq(expected, submitted)
    if (ok) session.__token__ = undefined
    return ok
  }
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
