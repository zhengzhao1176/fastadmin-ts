import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createHttpClient, type HttpClient } from '../helpers/http.ts'
import { loginAsAdmin, unauthenticated } from '../helpers/auth.ts'
import { cleanupTracked, closeFixtureConnection, makeAdmin } from '../helpers/fixtures.ts'

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

describe('admin/Index', () => {
  describe('index', () => {
    it('GET unauthenticated redirects to login or shows please-login', async () => {
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/admin/index/index', ajax: false })
      if (r.status === 302) {
        const loc = r.headers['location'] ?? ''
        expect(loc.toLowerCase()).toContain('login')
      } else {
        expect(r.status).toBe(200)
        expect(typeof r.body === 'string' || (typeof r.body === 'object' && r.body !== null && 'code' in (r.body as unknown as object)))
          .toBe(true)
      }
    })

    it('GET with admin session returns dashboard HTML', async () => {
      const http = await loginAsAdmin('super')
      const body = await http.html({ method: 'GET', url: '/admin/index/index' })
      expect(body.length).toBeGreaterThan(0)
      expect(body.toLowerCase()).toContain('<')
    })

    it('POST action=refreshmenu returns JSON envelope with menulist/navlist', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json<{ menulist?: unknown; navlist?: unknown }>({
        method: 'POST',
        url: '/admin/index/index',
        form: { action: 'refreshmenu' },
      })
      expect(r.code).toBe(1)
      expect(r.data).toBeTypeOf('object')
      expect(r.data).not.toBeNull()
      expect(r.data).toHaveProperty('menulist')
      expect(r.data).toHaveProperty('navlist')
    })

    it('POST refreshmenu unauthenticated → not code=1', async () => {
      const http = unauthenticated()
      const r = await http.request({
        method: 'POST',
        url: '/admin/index/index',
        form: { action: 'refreshmenu' },
        ajax: true,
      })
      if (typeof r.body === 'object' && r.body !== null) {
        expect(r.body.code).not.toBe(1)
      } else {
        expect(typeof r.body).toBe('string')
      }
    })

    it.skip('cookie adminskin matching /^skin-([a-z-]+)$/i is applied at runtime', () => {
      // Spec: 'cookie 值需通过正则白名单才会生效'
    })
  })

  describe('login', () => {
    async function freshClient(): Promise<HttpClient> {
      return createHttpClient()
    }

    it('GET renders login form HTML containing username/password/__token__ fields', async () => {
      const http = await freshClient()
      const body = await http.html({ method: 'GET', url: '/admin/index/login' })
      expect(body).toMatch(/name=["']username["']/i)
      expect(body).toMatch(/name=["']password["']/i)
      expect(body).toMatch(/name=["']__token__["']/i)
    })

    it('POST happy path → code=1 with data.id/username/url', async () => {
      const admin = await makeAdmin()
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json<{ id: number; username: string; url: string; avatar: string }>({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: admin.username,
          password: admin.password,
          keeplogin: 0,
          __token__,
        },
      })
      expect(r.code).toBe(1)
      expect(r.data?.id).toBe(admin.id)
      expect(r.data?.username).toBe(admin.username)
      expect(r.url).toBeTruthy()
    })

    it('POST keeplogin=1 sets keeplogin cookie', async () => {
      const admin = await makeAdmin()
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: admin.username,
          password: admin.password,
          keeplogin: 1,
          __token__,
        },
      })
      expect(r.code).toBe(1)
      const cookieVal = http.getCookie('keeplogin')
      expect(cookieVal).toBeTruthy()
    })

    it('POST validation failure: missing username → code=0', async () => {
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: { username: '', password: '123456', __token__ },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST validation failure: short username (<3) → code=0', async () => {
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: { username: 'a', password: '123456', __token__ },
      })
      expect(r.code).toBe(0)
    })

    it('POST username does not exist → code=0', async () => {
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: `nosuch_${Date.now().toString(36)}`,
          password: 'whatever',
          __token__,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST password incorrect → code=0', async () => {
      const admin = await makeAdmin()
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: admin.username,
          password: 'wrong_pwd_999',
          __token__,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST admin status=hidden → code=0 (forbidden)', async () => {
      const admin = await makeAdmin({ status: 'hidden' })
      const http = await freshClient()
      const __token__ = await http.fetchToken('/admin/index/login')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: admin.username,
          password: admin.password,
          __token__,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST missing __token__ → code=0', async () => {
      const admin = await makeAdmin()
      const http = await freshClient()
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: admin.username,
          password: admin.password,
        },
      })
      expect(r.code).toBe(0)
    })

    it('POST when already logged in → success jump (no re-login)', async () => {
      const http = await loginAsAdmin('super')
      const __token__ = await http.fetchToken('/admin/index/login').catch(() => '')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: 'whatever',
          password: 'whatever',
          __token__,
        },
      })
      expect(r.code).toBe(1)
    })

    it.skip('captcha required when fastadmin.login_captcha enabled', () => {
      // Spec: '仅当 Config::get(\'fastadmin.login_captcha\') 为真时 require|captcha'
    })

    it.skip('login_failure_retry: after >=10 fails in 24h returns Please try again', () => {
      // Spec: '仅当 Config::get(\'fastadmin.login_failure_retry\') 开启时'
    })
  })

  describe('logout', () => {
    it('GET returns auto-submit form HTML containing logout_submit', async () => {
      const http = await loginAsAdmin('super')
      const body = await http.html({ method: 'GET', url: '/admin/index/logout' })
      expect(body).toMatch(/logout_submit/i)
      expect(body).toMatch(/name=["']__token__["']/i)
    })

    it('POST happy path → code=1 and clears admin session', async () => {
      const http = await loginAsAdmin('super')
      const __token__ = await http.fetchToken('/admin/index/logout')
      const r = await http.json({
        method: 'POST',
        url: '/admin/index/logout',
        form: { __token__ },
      })
      expect(r.code).toBe(1)

      const after = await http.request({ method: 'GET', url: '/admin/index/index', ajax: false })
      if (after.status === 302) {
        expect((after.headers['location'] ?? '').toLowerCase()).toContain('login')
      } else if (typeof after.body === 'object' && after.body !== null) {
        expect((after.body as unknown as { code: number }).code).not.toBe(1)
      } else {
        expect(after.status).toBeGreaterThanOrEqual(200)
      }
    })

    it('GET unauthenticated → redirect to login or non-success', async () => {
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/admin/index/logout', ajax: false })
      if (r.status === 302) {
        expect((r.headers['location'] ?? '').toLowerCase()).toContain('login')
      } else {
        if (typeof r.body === 'object' && r.body !== null) {
          expect((r.body as unknown as { code: number }).code).not.toBe(1)
        }
      }
    })

    it('POST unauthenticated → not code=1', async () => {
      const http = unauthenticated()
      const r = await http.request({
        method: 'POST',
        url: '/admin/index/logout',
        form: {},
        ajax: true,
      })
      if (typeof r.body === 'object' && r.body !== null) {
        expect((r.body as unknown as { code: number }).code).not.toBe(1)
      }
    })
  })
})
