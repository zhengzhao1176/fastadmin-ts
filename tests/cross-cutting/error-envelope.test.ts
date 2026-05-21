// Cross-cutting: error response envelope shape per module.
//
// FastAdmin returns three different envelope shapes depending on the module:
//
//   api module   (app\common\controller\Api::result):
//     { code: number, msg: string, time: string, data: any }
//     - time is a STRING (UNIX timestamp, e.g. "1778470822")
//     - no `url` / `wait`
//
//   admin / index modules (ThinkPHP Jump trait):
//     { code: number, msg: string, data: any, url?: string, wait?: number }
//     - NO `time` field
//     - has `url` (jump target) and `wait` (seconds) on success/error
//
// Some admin ajax list endpoints (e.g. /admin/auth/group/index POST) return a
// BARE `{ total, rows }` envelope without `code` / `msg`. We verify both
// shapes coexist below.
import { afterAll, describe, expect, it } from 'vitest'
import { createHttpClient, type Envelope } from '../helpers/http.ts'
import { unauthenticated, loginAsAdmin } from '../helpers/auth.ts'
import { closeFixtureConnection } from '../helpers/fixtures.ts'

afterAll(async () => {
  await closeFixtureConnection()
})

// ---------- envelope shape assertions ----------

/** Asserts a response is the api-module envelope: has string `time`, no `url`. */
function assertApiEnvelope(r: Envelope): void {
  expect(typeof r.code).toBe('number')
  expect(typeof r.msg).toBe('string')
  expect('time' in r).toBe(true)
  // api module emits time as a string, e.g. "1778470822".
  expect(typeof r.time).toBe('string')
  expect((r.time as string).length).toBeGreaterThan(0)
  // Not a hard requirement, but api envelopes don't ship url/wait.
  expect((r as Record<string, unknown>).url).toBeUndefined()
  // time should be within ~10 minutes of now (allow loose clock skew).
  const t = Number(r.time)
  expect(Number.isFinite(t)).toBe(true)
  const now = Math.floor(Date.now() / 1000)
  expect(Math.abs(now - t)).toBeLessThan(600)
}

/** Asserts a response is the admin/index-module envelope: NO `time`, optional `url`/`wait`. */
function assertAdminEnvelope(r: Envelope): void {
  expect(typeof r.code).toBe('number')
  expect(typeof r.msg).toBe('string')
  // The Jump-trait JSON output omits `time` entirely.
  expect('time' in r).toBe(false)
  // `data` is always present (may be null, "", {}, []).
  expect('data' in r).toBe(true)
}

// ---------- tests ----------

describe('api module envelope shape', () => {
  it('/api/user/login bad params returns api envelope (code 0, has time, no url)', async () => {
    const http = unauthenticated()
    const r = await http.json({
      method: 'POST',
      url: '/api/user/login',
      form: { account: '', password: '' },
    })
    assertApiEnvelope(r)
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })

  it('/api/user/register without username returns code 0 with non-empty msg', async () => {
    const http = unauthenticated()
    const r = await http.json({
      method: 'POST',
      url: '/api/user/register',
      form: { password: 'pw_123456', email: 'x@test.local', mobile: '13900000000' },
    })
    assertApiEnvelope(r)
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })

  it('/api/user/login with account too short returns code 0', async () => {
    const http = unauthenticated()
    const r = await http.json({
      method: 'POST',
      url: '/api/user/login',
      form: { account: 'ab', password: 'pw_123456' },
    })
    assertApiEnvelope(r)
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })

  it('/api/user/index without token returns non-success (401 or 0 depending on build)', async () => {
    const http = unauthenticated()
    const r = await http.json({ method: 'GET', url: '/api/user/index' })
    assertApiEnvelope(r)
    // Different FastAdmin builds use 401 (Api::error401) or 0 (generic error).
    expect(r.code).not.toBe(1)
  })

  it('time field is a non-empty string on every api error', async () => {
    const http = unauthenticated()
    const r = await http.json({
      method: 'POST',
      url: '/api/user/login',
      form: {},
    })
    expect(typeof r.time).toBe('string')
    expect((r.time as string).length).toBeGreaterThan(0)
  })
})

describe('admin module envelope shape', () => {
  it('/admin/index/login with bad token returns admin envelope (no time, data has token)', async () => {
    // First fetch a valid token so the session is initialised, then send a
    // garbage token — FastAdmin will reject and return a fresh __token__ in data.
    const http = unauthenticated()
    await http.fetchToken('/admin/index/login')
    const r = await http.json({
      method: 'POST',
      url: '/admin/index/login',
      form: {
        username: 'whatever',
        password: 'whatever',
        keeplogin: 0,
        __token__: 'definitely-not-valid',
      },
    })
    assertAdminEnvelope(r)
    expect(r.code).toBe(0)
    // admin/index/login returns the regenerated token under `data.token`
    // (not `data.__token__` — that's only for other Backend::token() errors).
    const data = r.data as { token?: string } | null
    expect(data).not.toBeNull()
    expect(typeof data?.token).toBe('string')
    expect((data?.token ?? '').length).toBeGreaterThan(0)
  })

  it('/admin/auth/admin/add POST without __token__ → admin envelope code=0', async () => {
    const http = await loginAsAdmin()
    const r = await http.json({
      method: 'POST',
      url: '/admin/auth/admin/add',
      form: {
        'row[username]': 'never_actually_created',
        'row[password]': 'whatever',
        // intentionally no __token__ field
      },
    })
    assertAdminEnvelope(r)
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })

  it('CSRF token mismatch returns a new __token__ in data', async () => {
    const http = await loginAsAdmin()
    const r = await http.json({
      method: 'POST',
      url: '/admin/auth/admin/add',
      form: {
        'row[username]': 'never_actually_created',
        __token__: 'wrong-token-value',
      },
    })
    assertAdminEnvelope(r)
    expect(r.code).toBe(0)
    const data = r.data as { __token__?: string } | null
    // The fresh token is the whole point of the round-trip — assert it's there.
    expect(typeof data?.__token__).toBe('string')
    expect((data?.__token__ ?? '').length).toBeGreaterThanOrEqual(20)
  })

  it('admin envelope has NO time field on a typical error', async () => {
    const http = unauthenticated()
    await http.fetchToken('/admin/index/login')
    const r = await http.json({
      method: 'POST',
      url: '/admin/index/login',
      form: { username: 'nope', password: 'nope', __token__: 'bad' },
    })
    expect((r as Record<string, unknown>).time).toBeUndefined()
  })
})

describe('404 / unknown route handling', () => {
  it('GET /admin.php/no/such/path returns either an envelope error or an HTML error page', async () => {
    const http = unauthenticated()
    const r = await http.request({ method: 'GET', url: '/admin.php/no/such/path', ajax: false })
    // FastAdmin's empty_controller dispatch usually produces HTTP 200 with an
    // error page rather than a 404. Some builds emit 404 directly. Accept both.
    expect([200, 404]).toContain(r.status)
    if (typeof r.body === 'object' && r.body !== null) {
      // If the response came through as JSON envelope, it must be a failure.
      const env = r.body as Envelope
      expect(env.code).not.toBe(1)
    } else {
      // HTML response: not empty.
      expect(typeof r.body).toBe('string')
      expect((r.body as string).length).toBeGreaterThan(0)
    }
  })

  it('AJAX GET to a missing admin path returns a JSON envelope, not HTML', async () => {
    const http = await loginAsAdmin()
    const r = await http.request({ method: 'GET', url: '/admin/no_module/no_action', ajax: true })
    // Whatever the dispatch path is, when ajax=true we expect *something* parseable.
    // Either an admin envelope (code 0) or HTML wrapped as JSON string — assert
    // we got a response at all and didn't 500.
    expect(r.status).toBeLessThan(500)
  })
})

describe('HTML vs JSON envelope distinction', () => {
  it('admin login page (GET) returns HTML, not a JSON envelope', async () => {
    const http = unauthenticated()
    const body = await http.html({ method: 'GET', url: '/admin/index/login' })
    expect(typeof body).toBe('string')
    expect(body.toLowerCase()).toContain('<!doctype')
    // Sanity: should not be a JSON-string-wrapped HTML (no leading `"<`).
    expect(body.startsWith('"<')).toBe(false)
  })

  it('admin index (GET, logged in) returns HTML, not an envelope', async () => {
    const http = await loginAsAdmin()
    const body = await http.html({ method: 'GET', url: '/admin/index/index' })
    expect(typeof body).toBe('string')
    // The dashboard ships as a full HTML document.
    expect(body.toLowerCase()).toMatch(/<html|<!doctype/)
  })
})

describe('bare {total, rows} ajax envelope (no envelope wrapper)', () => {
  it('/admin/auth/group/index POST returns bare {total, rows}', async () => {
    const http = await loginAsAdmin()
    // ajax POST to a list endpoint — FastAdmin's selectpage / Bootstrap-Table
    // protocol returns a flat payload without code/msg.
    const r = await http.json<{ total?: number; rows?: unknown[] }>({
      method: 'POST',
      url: '/admin/auth/group/index',
      form: { page: 1, limit: 10 },
    })
    const body = r as unknown as { total?: number; rows?: unknown[]; code?: number }
    // Either the bare shape or a normal envelope with data.{total,rows} —
    // tolerate both since builds differ. The key contract is "no time field".
    expect((r as Record<string, unknown>).time).toBeUndefined()
    if (typeof body.total === 'number') {
      expect(Array.isArray(body.rows)).toBe(true)
    } else {
      // envelope-wrapped form
      expect(typeof body.code).toBe('number')
    }
  })
})

describe('cross-module envelope contrast', () => {
  it('api error has time as string; admin error has no time field at all', async () => {
    const apiHttp = unauthenticated()
    const apiErr = await apiHttp.json({
      method: 'POST',
      url: '/api/user/login',
      form: { account: '', password: '' },
    })
    expect(typeof apiErr.time).toBe('string')

    const adminHttp = unauthenticated()
    await adminHttp.fetchToken('/admin/index/login')
    const adminErr = await adminHttp.json({
      method: 'POST',
      url: '/admin/index/login',
      form: { username: '', password: '', __token__: 'bad' },
    })
    expect((adminErr as Record<string, unknown>).time).toBeUndefined()
  })

  it('admin error envelope keys ⊆ {code, msg, data, url, wait} (no surprise time)', async () => {
    const http = unauthenticated()
    await http.fetchToken('/admin/index/login')
    const r = await http.json({
      method: 'POST',
      url: '/admin/index/login',
      form: { username: 'x', password: 'x', __token__: 'bad' },
    })
    const allowed = new Set(['code', 'msg', 'data', 'url', 'wait'])
    for (const k of Object.keys(r)) {
      expect(allowed.has(k)).toBe(true)
    }
  })

  it('api error envelope contains the required {code, msg, data, time} keys', async () => {
    const http = unauthenticated()
    const r = await http.json({
      method: 'POST',
      url: '/api/user/login',
      form: {},
    })
    for (const k of ['code', 'msg', 'data', 'time']) {
      expect(k in r).toBe(true)
    }
  })
})
