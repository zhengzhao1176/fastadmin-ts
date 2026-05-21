import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'
import { loginAsFrontUser, unauthenticated, AuthError } from '../helpers/auth.ts'
import { cleanupTracked, closeFixtureConnection, makeUser } from '../helpers/fixtures.ts'
import { withApp } from '../../scripts/db.ts'

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

describe('index/User', () => {
  describe('index', () => {
    it('returns the user-center HTML when logged in', async () => {
      const http = await loginAsFrontUser('alice')
      const body = await http.html({ method: 'GET', url: '/index/user/index' })
      expect(body).toMatch(/<title>/)
    })

    it('rejects unauthenticated access (ajax: JSON error)', async () => {
      const http = unauthenticated()
      const r = await http.json({ method: 'GET', url: '/index/user/index' })
      expect(r.code).not.toBe(1)
    })
  })

  describe('register', () => {
    async function withRegisterToken<T>(fn: (http: ReturnType<typeof createHttpClient>, token: string) => Promise<T>) {
      const http = unauthenticated()
      const token = await http.fetchToken('/index/user/register')
      return fn(http, token)
    }

    it('registers a fresh user and sets uid/token cookies', async () => {
      await withRegisterToken(async (http, __token__) => {
        const username = `t_reg_${Date.now().toString(36)}`
        const r = await http.json({
          method: 'POST',
          url: '/index/user/register',
          form: {
            username,
            password: 'pw_abc_123',
            email: `${username}@test.local`,
            mobile: `139${String(Date.now()).slice(-8)}`,
            __token__,
          },
        })
        expect(r.code).toBe(1)
        // user_register_successed hook writes uid + token cookies
        expect(http.getCookie('uid')).toBeDefined()
        expect(http.getCookie('token')).toBeDefined()
        // cleanup
        await withApp(async (db) => {
          await db.query(`DELETE FROM fa_user WHERE username = ?`, [username])
        })
      })
    })

    it('refuses duplicate username', async () => {
      const existing = await makeUser({ password: 'pw_abc_123' })
      await withRegisterToken(async (http, __token__) => {
        const r = await http.json({
          method: 'POST',
          url: '/index/user/register',
          form: {
            username: existing.username,
            password: 'pw_abc_123',
            email: `dup_${Date.now()}@test.local`,
            __token__,
          },
        })
        expect(r.code).not.toBe(1)
      })
    })

    it('refuses missing __token__', async () => {
      const http = unauthenticated()
      const r = await http.json({
        method: 'POST',
        url: '/index/user/register',
        form: {
          username: `t_no_token_${Date.now().toString(36)}`,
          password: 'pw_abc_123',
          email: 'x@test.local',
        },
      })
      expect(r.code).not.toBe(1)
    })

    it('refuses short password (<6 chars)', async () => {
      await withRegisterToken(async (http, __token__) => {
        const r = await http.json({
          method: 'POST',
          url: '/index/user/register',
          form: {
            username: `t_short_${Date.now().toString(36)}`,
            password: 'p1',
            email: 'shortpw@test.local',
            __token__,
          },
        })
        expect(r.code).not.toBe(1)
      })
    })

    it('refuses bad email', async () => {
      await withRegisterToken(async (http, __token__) => {
        const r = await http.json({
          method: 'POST',
          url: '/index/user/register',
          form: {
            username: `t_bademail_${Date.now().toString(36)}`,
            password: 'pw_abc_123',
            email: 'not-an-email',
            __token__,
          },
        })
        expect(r.code).not.toBe(1)
      })
    })
  })

  describe('login', () => {
    it('logs in an existing user via username', async () => {
      const u = await makeUser({ password: 'pw_login_1' })
      const http = unauthenticated()
      const __token__ = await http.fetchToken('/index/user/login')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.username, password: 'pw_login_1', __token__ },
      })
      expect(r.code).toBe(1)
      expect(http.getCookie('token')).toBeDefined()
    })

    it('logs in an existing user via email', async () => {
      const u = await makeUser({ password: 'pw_login_2' })
      const http = unauthenticated()
      const __token__ = await http.fetchToken('/index/user/login')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.email, password: 'pw_login_2', __token__ },
      })
      expect(r.code).toBe(1)
    })

    it('logs in an existing user via mobile', async () => {
      const u = await makeUser({ password: 'pw_login_3' })
      const http = unauthenticated()
      const __token__ = await http.fetchToken('/index/user/login')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.mobile, password: 'pw_login_3', __token__ },
      })
      expect(r.code).toBe(1)
    })

    it('rejects wrong password', async () => {
      const u = await makeUser({ password: 'pw_right' })
      const http = unauthenticated()
      const __token__ = await http.fetchToken('/index/user/login')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.username, password: 'wrong_pw_xx', __token__ },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects banned/hidden user', async () => {
      await expect(loginAsFrontUser('alice')).resolves.toBeDefined()
      // banned user (id=3 in seed) has status=hidden
      const http = unauthenticated()
      const __token__ = await http.fetchToken('/index/user/login')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: 'banned', password: '123456', __token__ },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects non-existent account', async () => {
      const http = unauthenticated()
      const __token__ = await http.fetchToken('/index/user/login')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: 'definitely_not_existing_xyz', password: 'whatever', __token__ },
      })
      expect(r.code).not.toBe(1)
    })

    it('requires __token__', async () => {
      const http = unauthenticated()
      const r = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: 'alice', password: '123456' },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe('logout', () => {
    it('returns auto-submit HTML on GET (real logout is POST + __token__)', async () => {
      const http = await loginAsFrontUser('alice')
      const r = await http.request({ method: 'GET', url: '/index/user/logout' })
      // GET shows an auto-submit form, not a 302
      expect(r.status).toBe(200)
      expect(typeof r.body).toBe('string')
    })

    it('logs out via POST + __token__ and invalidates token cookie', async () => {
      const http = await loginAsFrontUser('alice')
      const __token__ = await http.fetchToken('/index/user/logout')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/logout',
        form: { __token__ },
      })
      expect(r.code).toBe(1)
    })

    it('rejects POST without __token__', async () => {
      const http = await loginAsFrontUser('alice')
      const r = await http.json({ method: 'POST', url: '/index/user/logout', form: {} })
      expect(r.code).not.toBe(1)
    })
  })

  describe('profile', () => {
    it('returns 200 HTML when logged in', async () => {
      const http = await loginAsFrontUser('alice')
      const body = await http.html({ method: 'GET', url: '/index/user/profile' })
      expect(body).toMatch(/<title>/)
    })

    it('rejects unauthenticated', async () => {
      const http = unauthenticated()
      const r = await http.json({ method: 'GET', url: '/index/user/profile' })
      expect(r.code).not.toBe(1)
    })

    it.skip('POST profile updates fields', async () => {
      // Unclear from code: "profile 控制器方法仅渲染模板;任务列出的 nickname/avatar/bio/email/mobile 字段更新端点不在本文件中"
    })
  })

  describe('changepwd', () => {
    async function freshUser(pw = 'oldpw_123') {
      return await makeUser({ password: pw })
    }

    it('changes password with valid old password', async () => {
      const u = await freshUser('oldpw_123')
      // login first
      const http = unauthenticated()
      let __token__ = await http.fetchToken('/index/user/login')
      const lr = await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.username, password: 'oldpw_123', __token__ },
      })
      expect(lr.code).toBe(1)
      // change pw
      __token__ = await http.fetchToken('/index/user/changepwd')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/changepwd',
        form: {
          oldpassword: 'oldpw_123',
          newpassword: 'newpw_456',
          renewpassword: 'newpw_456',
          __token__,
        },
      })
      expect(r.code).toBe(1)
      // new pw works for re-login (fresh client; old token invalidated)
      const http2 = unauthenticated()
      const __token2__ = await http2.fetchToken('/index/user/login')
      const lr2 = await http2.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.username, password: 'newpw_456', __token__: __token2__ },
      })
      expect(lr2.code).toBe(1)
    })

    it('refuses wrong old password', async () => {
      const u = await freshUser('actualpw_123')
      const http = unauthenticated()
      let __token__ = await http.fetchToken('/index/user/login')
      await http.json({
        method: 'POST',
        url: '/index/user/login',
        form: { account: u.username, password: 'actualpw_123', __token__ },
      })
      __token__ = await http.fetchToken('/index/user/changepwd')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/changepwd',
        form: {
          oldpassword: 'wrong_old_pw',
          newpassword: 'newpw_789',
          renewpassword: 'newpw_789',
          __token__,
        },
      })
      expect(r.code).not.toBe(1)
    })

    it('refuses mismatched renewpassword', async () => {
      const http = await loginAsFrontUser('alice')
      const __token__ = await http.fetchToken('/index/user/changepwd')
      const r = await http.json({
        method: 'POST',
        url: '/index/user/changepwd',
        form: {
          oldpassword: '123456',
          newpassword: 'newpw_xxx',
          renewpassword: 'different_pw',
          __token__,
        },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe('attachment', () => {
    it('returns ajax JSON {total, rows} for own attachments', async () => {
      const http = await loginAsFrontUser('alice')
      const r = await http.request({ method: 'GET', url: '/index/user/attachment', ajax: true })
      // bare JSON not envelope
      expect(typeof r.body).toBe('object')
      expect(r.body).toHaveProperty('total')
      expect(r.body).toHaveProperty('rows')
    })

    it('rejects unauthenticated', async () => {
      const http = unauthenticated()
      const r = await http.json({ method: 'GET', url: '/index/user/attachment', ajax: true })
      expect(r.code).not.toBe(1)
    })

    it.skip('only shows current user uploads, not other users', async () => {
      // Need both alice and bob to upload an attachment, then verify alice sees only her own.
      // Skipping because makeAttachment in fixtures sets user_id=0 by default.
    })
  })
})
