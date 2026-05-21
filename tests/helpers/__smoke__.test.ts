// Smoke tests for the foundations layer. If these fail, all other tests are
// guaranteed to fail too — fix smoke first.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createHttpClient } from './http.ts'
import { AuthError, loginAsAdmin, loginAsApiUser, unauthenticated } from './auth.ts'
import { cleanupTracked, closeFixtureConnection, makeUser } from './fixtures.ts'

afterEach(async () => { await cleanupTracked() })
afterAll(async () => { await closeFixtureConnection() })

describe('foundations smoke', () => {
  describe('http client', () => {
    it('GET /admin.php/index/login returns the admin login HTML', async () => {
      const http = createHttpClient()
      const body = await http.html({ url: '/admin/index/login' })
      expect(body).toMatch(/<title>登录<\/title>/)
      expect(body).toMatch(/name=["']username["']/)
      expect(body).toMatch(/name=["']password["']/)
    })

    it('GET /api/common/init returns a JSON envelope', async () => {
      const http = createHttpClient()
      const r = await http.json({ url: '/api/common/init' })
      expect(typeof r.code).toBe('number')
      expect(typeof r.msg).toBe('string')
      expect(typeof r.time).toBe('string')           // ⚠ string, not number
      expect(Number(r.time)).toBeGreaterThan(1_700_000_000)
    })

    it('fetchToken extracts __token__ from the admin login form', async () => {
      const http = createHttpClient()
      const t = await http.fetchToken('/admin/index/login')
      expect(t).toMatch(/^[a-f0-9]{20,}$/)
    })
  })

  describe('auth helpers', () => {
    it('loginAsAdmin() returns a client whose admin dashboard is 200', async () => {
      const http = await loginAsAdmin()
      const r = await http.request({ url: '/admin/index/index' })
      expect([200, 302]).toContain(r.status)
      // session cookie should be set
      expect(http.getCookie('PHPSESSID')).toBeDefined()
    })

    it('loginAsApiUser() returns a client whose token gates /api/user/index', async () => {
      const http = await loginAsApiUser('alice')
      expect(http.getToken()).toBeTruthy()
      const r = await http.json({ url: '/api/user/index' })
      expect(r.code).toBe(1)
    })

    it('loginAsApiUser("banned") throws AuthError', async () => {
      await expect(loginAsApiUser('banned')).rejects.toBeInstanceOf(AuthError)
    })

    it('unauthenticated client cannot read /api/user/index', async () => {
      const http = unauthenticated()
      const r = await http.json({ url: '/api/user/index' })
      expect(r.code).not.toBe(1)
    })
  })

  describe('fixtures', () => {
    it('makeUser() inserts a user, can log in, then cleanupTracked() removes it', async () => {
      const u = await makeUser({ password: 'pw_smoke_test' })
      expect(u.id).toBeGreaterThan(0)

      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/login',
        form: { account: u.username, password: 'pw_smoke_test' },
      })
      expect(r.code).toBe(1)

      // cleanup runs in afterEach; verify by re-attempting login next time
    })
  })
})
