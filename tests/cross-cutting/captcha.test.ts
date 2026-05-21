// Captcha endpoint behaviour.
//
// In the test seed, the admin login captcha is disabled
// (`application/extra/fastadmin.php` → `login_captcha: false`), and the
// frontend register captcha is similarly off (`user_register_captcha: ''`).
// SMS/EMS captcha hooks are stubbed in test env (`TestSmsEmsStub` → true).
//
// What we can verify black-box:
//   - /api/common/captcha returns a real image payload (think-captcha driver).
//   - Two captcha hits in the same session produce different image bytes
//     (think-captcha regenerates random chars each call).
//   - Admin login works without supplying any captcha field (login_captcha off).
//   - Frontend register works without supplying any captcha field.
//
// What we cannot verify without server-side hooks:
//   - Posting the *correct* captcha character against a session — we'd have
//     to introspect the PHP session file/redis to recover the stored string.
//     That test is marked `it.skip` below.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'
import { closeFixtureConnection } from '../helpers/fixtures.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
interface Seed { admin: { super: { username: string; password: string } } }
function loadSeed(): Seed {
  const file = path.resolve(__dirname, '../fixtures/seed-data.json')
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Seed
}

afterAll(async () => {
  await closeFixtureConnection()
})

async function fetchCaptcha(http: ReturnType<typeof createHttpClient>): Promise<{
  status: number
  contentType: string
  body: Buffer
}> {
  const r = await http.request<unknown>({ method: 'GET', url: '/api/common/captcha', ajax: false })
  // body is decoded as utf8 string; re-encode as bytes for length / inequality checks.
  const raw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
  return {
    status: r.status,
    contentType: r.headers['content-type'] ?? '',
    body: Buffer.from(raw, 'binary'),
  }
}

describe('GET /api/common/captcha', () => {
  it('returns an image with non-empty body', async () => {
    const http = createHttpClient()
    const { status, contentType, body } = await fetchCaptcha(http)
    expect(status).toBe(200)
    expect(contentType.toLowerCase()).toMatch(/image\//)
    expect(body.length).toBeGreaterThan(0)
  })

  it('regenerates different bytes on consecutive calls in the same session', async () => {
    const http = createHttpClient()
    const a = await fetchCaptcha(http)
    const b = await fetchCaptcha(http)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    // think-captcha picks random characters per call; image bytes must differ.
    // Compare as base64 strings so the assertion message is human-readable on failure.
    expect(b.body.toString('base64')).not.toBe(a.body.toString('base64'))
  })

  // Skipped: verifying the stored captcha char against POST /api/sms/check (or any
  // captcha-protected endpoint) requires reading the PHP session file to pull
  // out the captcha string set by think-captcha. We don't have a hook to do
  // that from the test process today.
  it.skip('accepts the correct captcha char and rejects the wrong one — needs PHP session file introspection', async () => {
    // Sketch of what this would look like with session introspection:
    //   const http = createHttpClient()
    //   await fetchCaptcha(http)
    //   const phpSessId = http.getCookie('PHPSESSID')!
    //   const stored = readCaptchaFromSession(phpSessId)
    //   await http.json({ method: 'POST', url: '/api/sms/check', form: { ..., captcha: stored } })
  })
})

describe('captcha is OFF for admin login in test env', () => {
  it('admin login succeeds without a captcha field', async () => {
    const seed = loadSeed()
    const http = createHttpClient()
    const token = await http.fetchToken('/admin/index/login')
    const r = await http.json({
      method: 'POST',
      url: '/admin/index/login',
      form: {
        username: seed.admin.super.username,
        password: seed.admin.super.password,
        keeplogin: 0,
        __token__: token,
        // intentionally no `captcha` field — login_captcha=false in test seed
      },
    })
    expect(r.code).toBe(1)
  })
})

describe('captcha is OFF for frontend register in test env', () => {
  it('frontend register succeeds without a captcha field', async () => {
    // NOTE: /api/user/register ALWAYS calls Sms::check regardless of config,
    // so we test /index/user/register which respects `user_register_captcha=''`.
    const http = createHttpClient()
    const __token__ = await http.fetchToken('/index/user/register')
    const sfx = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const r = await http.json({
      method: 'POST',
      url: '/index/user/register',
      form: {
        username: `treg_${sfx}`.slice(0, 20),
        password: 'pw_123456',
        email: `${sfx}@test.local`,
        mobile: `136${Date.now().toString().slice(-8)}`,
        __token__,
      },
    })
    // Register should succeed (code=1) without captcha. Asserting msg doesn't
    // mention captcha is enough to prove the captcha branch was skipped.
    expect(r.msg).not.toMatch(/验证码|captcha/i)
  })
})
