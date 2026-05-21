// Real captcha image generator. Wraps svg-captcha (pure JS, no native deps)
// to produce a distorted SVG with noise lines + rotation, matching the
// think-captcha look-and-feel closely enough that the UI widget renders
// without changes.
import { Injectable } from '@nestjs/common'
import svgCaptcha from 'svg-captcha'

export interface CaptchaIssued {
  svg: string
  /** Lowercased canonical answer to compare against user input. */
  code: string
}

export interface SessionCaptcha {
  code: string
  expiretime: number   // unix seconds
}

@Injectable()
export class CaptchaImageService {
  /** Generate a fresh captcha SVG + answer; caller stashes the answer in session. */
  issue(): CaptchaIssued {
    const c = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1ilI',
      noise: 2,
      color: true,
      background: '#f4f4f4',
      width: 100,
      height: 36,
    })
    return { svg: c.data, code: String(c.text).toLowerCase() }
  }

  /**
   * Compare a user-submitted answer against `session.captcha`. Returns true if
   * matches AND not expired. Consumes (clears) the session entry on match so
   * a captcha can't be re-used.
   */
  verify(session: { captcha?: SessionCaptcha } & Record<string, unknown>, submitted: string): boolean {
    const entry = session.captcha
    if (!entry || !submitted) return false
    const now = Math.floor(Date.now() / 1000)
    if (entry.expiretime <= now) {
      delete session.captcha
      return false
    }
    const ok = String(submitted).toLowerCase() === entry.code
    if (ok) delete session.captcha
    return ok
  }
}
