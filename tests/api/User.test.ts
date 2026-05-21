import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'
import { loginAsApiUser, unauthenticated, AuthError } from '../helpers/auth.ts'
import { cleanupTracked, closeFixtureConnection, makeUser } from '../helpers/fixtures.ts'
import { withApp, loadDbConfig } from '../../scripts/db.ts'

const cfg = loadDbConfig()
const PFX = cfg.prefix

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

// --- helpers --------------------------------------------------------------

async function insertSmsCode(mobile: string, event: string, code: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await withApp(async (db) => {
    await db.query(
      `INSERT INTO \`${PFX}sms\` (event, mobile, code, times, ip, createtime)
       VALUES (?, ?, ?, 0, '127.0.0.1', ?)`,
      [event, mobile, code, now],
    )
  })
}

async function insertEmsCode(email: string, event: string, code: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await withApp(async (db) => {
    await db.query(
      `INSERT INTO \`${PFX}ems\` (event, email, code, times, ip, createtime)
       VALUES (?, ?, ?, 0, '127.0.0.1', ?)`,
      [event, email, code, now],
    )
  })
}

// --- tests ----------------------------------------------------------------

describe('api/User', () => {
  describe('index', () => {
    it('returns welcome data for logged-in user', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json<{ welcome: string }>({ method: 'GET', url: '/api/user/index' })
      expect(r.code).toBe(1)
      expect(r.data).toHaveProperty('welcome')
    })

    it('rejects no token', async () => {
      const http = unauthenticated()
      const r = await http.json({ method: 'GET', url: '/api/user/index' })
      expect(r.code).not.toBe(1)
    })

    it('rejects invalid token', async () => {
      const http = createHttpClient()
      http.setToken('not-a-real-token-xxx')
      const r = await http.json({ method: 'GET', url: '/api/user/index' })
      expect(r.code).not.toBe(1)
    })
  })

  describe('login', () => {
    it('logs in via username + password', async () => {
      const u = await makeUser({ password: 'pw_apilogin_1' })
      const http = createHttpClient()
      const r = await http.json<{ userinfo: { token: string } }>({
        method: 'POST',
        url: '/api/user/login',
        form: { account: u.username, password: 'pw_apilogin_1' },
      })
      expect(r.code).toBe(1)
      expect(r.data?.userinfo?.token).toMatch(/^[0-9a-f-]{20,}$/i)
    })

    it('logs in via email', async () => {
      const u = await makeUser({ password: 'pw_apilogin_2' })
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/login',
        form: { account: u.email, password: 'pw_apilogin_2' },
      })
      expect(r.code).toBe(1)
    })

    it('logs in via mobile', async () => {
      const u = await makeUser({ password: 'pw_apilogin_3' })
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/login',
        form: { account: u.mobile, password: 'pw_apilogin_3' },
      })
      expect(r.code).toBe(1)
    })

    it('rejects missing parameters', async () => {
      const http = createHttpClient()
      const r = await http.json({ method: 'POST', url: '/api/user/login', form: {} })
      expect(r.code).not.toBe(1)
    })

    it('rejects unknown account', async () => {
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/login',
        form: { account: 'definitely_not_existing_qwerty', password: '123456' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects wrong password', async () => {
      const u = await makeUser({ password: 'pw_real' })
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/login',
        form: { account: u.username, password: 'pw_wrong' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects banned (hidden status) account', async () => {
      // banned user from seed
      await expect(loginAsApiUser('banned')).rejects.toBeInstanceOf(AuthError)
    })
  })

  describe('mobilelogin', () => {
    it('logs in via mobile + SMS code (auto-registers unknown mobile)', async () => {
      const mobile = '139' + String(Date.now()).slice(-8)
      const code = '1234'
      await insertSmsCode(mobile, 'mobilelogin', code)
      const http = createHttpClient()
      const r = await http.json<{ userinfo: { token: string; mobile: string } }>({
        method: 'POST',
        url: '/api/user/mobilelogin',
        form: { mobile, captcha: code },
      })
      expect(r.code).toBe(1)
      expect(r.data?.userinfo?.mobile).toBe(mobile)
      // cleanup: delete the auto-registered user
      await withApp((db) => db.query(`DELETE FROM \`${PFX}user\` WHERE mobile = ?`, [mobile]))
    })

    it('rejects bad mobile format', async () => {
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/mobilelogin',
        form: { mobile: 'not-a-phone', captcha: '1234' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects wrong SMS code', async () => {
      const mobile = '139' + String(Date.now()).slice(-8)
      await insertSmsCode(mobile, 'mobilelogin', '1234')
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/mobilelogin',
        form: { mobile, captcha: '9999' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects when status is hidden', async () => {
      // make user banned
      const mobile = '139' + String(Date.now()).slice(-8)
      await makeUser({ status: 'hidden', mobile })
      await insertSmsCode(mobile, 'mobilelogin', '4321')
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/mobilelogin',
        form: { mobile, captcha: '4321' },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe('register', () => {
    it('registers a fresh user with mobile + SMS code', async () => {
      const sfx = Date.now().toString(36)
      const username = `t_reg_${sfx}`
      const mobile = '139' + String(Date.now()).slice(-8)
      const code = '5678'
      await insertSmsCode(mobile, 'register', code)
      const http = createHttpClient()
      const r = await http.json<{ userinfo: { token: string; username: string } }>({
        method: 'POST',
        url: '/api/user/register',
        form: {
          username,
          password: 'pw_reg_xxx',
          email: `${username}@test.local`,
          mobile,
          code,
        },
      })
      expect(r.code).toBe(1)
      expect(r.data?.userinfo?.token).toBeTruthy()
      await withApp((db) => db.query(`DELETE FROM \`${PFX}user\` WHERE username = ?`, [username]))
    })

    it('rejects missing username/password', async () => {
      const http = createHttpClient()
      const r = await http.json({ method: 'POST', url: '/api/user/register', form: {} })
      expect(r.code).not.toBe(1)
    })

    it('rejects bad email format', async () => {
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/register',
        form: {
          username: `t_bademail_${Date.now().toString(36)}`,
          password: 'pw_xxx',
          email: 'not-an-email',
          code: '0000',
        },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects bad mobile format', async () => {
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/register',
        form: {
          username: `t_badmob_${Date.now().toString(36)}`,
          password: 'pw_xxx',
          mobile: '12345',
          code: '0000',
        },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects duplicate username', async () => {
      const u = await makeUser()
      const mobile = '139' + String(Date.now()).slice(-8)
      const code = '5678'
      await insertSmsCode(mobile, 'register', code)
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/register',
        form: {
          username: u.username,
          password: 'pw_xxx',
          email: `dup_${Date.now()}@test.local`,
          mobile,
          code,
        },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe('logout', () => {
    it('invalidates the current token', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json({ method: 'POST', url: '/api/user/logout' })
      expect(r.code).toBe(1)
      // use the same (now-invalidated) token
      const r2 = await http.json({ method: 'GET', url: '/api/user/index' })
      expect(r2.code).not.toBe(1)
    })

    it('rejects non-POST', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json({ method: 'GET', url: '/api/user/logout' })
      expect(r.code).not.toBe(1)
    })

    it('rejects when not logged in', async () => {
      const http = unauthenticated()
      const r = await http.json({ method: 'POST', url: '/api/user/logout' })
      expect(r.code).not.toBe(1)
    })
  })

  describe('profile', () => {
    it('updates nickname and bio for current user', async () => {
      const http = await loginAsApiUser('alice')
      const newNick = `alice_${Date.now().toString(36)}`
      const r = await http.json({
        method: 'POST',
        url: '/api/user/profile',
        form: { nickname: newNick, bio: 'hello world' },
      })
      expect(r.code).toBe(1)
      // verify via DB
      const rows = await withApp(async (db) => {
        const [r] = await db.query(`SELECT nickname, bio FROM \`${PFX}user\` WHERE username = 'alice'`)
        return r as Array<{ nickname: string; bio: string }>
      })
      expect(rows[0]?.nickname).toBe(newNick)
      expect(rows[0]?.bio).toBe('hello world')
    })

    it('rejects when not logged in', async () => {
      const http = unauthenticated()
      const r = await http.json({ method: 'POST', url: '/api/user/profile', form: { nickname: 'x' } })
      expect(r.code).not.toBe(1)
    })

    it('rejects duplicate nickname taken by another user', async () => {
      const other = await makeUser({ nickname: `taken_${Date.now()}` })
      const http = await loginAsApiUser('alice')
      const r = await http.json({
        method: 'POST',
        url: '/api/user/profile',
        form: { nickname: other.nickname },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe('changeemail', () => {
    it('changes email with valid EMS code', async () => {
      const http = await loginAsApiUser('alice')
      const newEmail = `alice_new_${Date.now()}@test.local`
      const code = '1357'
      await insertEmsCode(newEmail, 'changeemail', code)
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changeemail',
        form: { email: newEmail, captcha: code },
      })
      expect(r.code).toBe(1)
      // restore original
      await withApp((db) =>
        db.query(`UPDATE \`${PFX}user\` SET email = 'alice@test.local' WHERE username = 'alice'`),
      )
    })

    it('rejects missing params', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json({ method: 'POST', url: '/api/user/changeemail', form: {} })
      expect(r.code).not.toBe(1)
    })

    it('rejects bad email format', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changeemail',
        form: { email: 'bad', captcha: '0000' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects email already taken by another user', async () => {
      const other = await makeUser({ email: `taken_${Date.now()}@test.local` })
      const http = await loginAsApiUser('alice')
      await insertEmsCode(other.email, 'changeemail', '2468')
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changeemail',
        form: { email: other.email, captcha: '2468' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects wrong captcha', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changeemail',
        form: { email: `try_${Date.now()}@test.local`, captcha: '9999' },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe('changemobile', () => {
    it('changes mobile with valid SMS code', async () => {
      const http = await loginAsApiUser('alice')
      const newMobile = '139' + String(Date.now()).slice(-8)
      const code = '3344'
      await insertSmsCode(newMobile, 'changemobile', code)
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changemobile',
        form: { mobile: newMobile, captcha: code },
      })
      expect(r.code).toBe(1)
      // restore
      await withApp((db) =>
        db.query(`UPDATE \`${PFX}user\` SET mobile = '13800000001' WHERE username = 'alice'`),
      )
    })

    it('rejects bad mobile format', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changemobile',
        form: { mobile: 'not-a-mobile', captcha: '0000' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects mobile taken by another user', async () => {
      const other = await makeUser({ mobile: '139' + String(Date.now()).slice(-8) })
      const http = await loginAsApiUser('alice')
      await insertSmsCode(other.mobile, 'changemobile', '5566')
      const r = await http.json({
        method: 'POST',
        url: '/api/user/changemobile',
        form: { mobile: other.mobile, captcha: '5566' },
      })
      expect(r.code).not.toBe(1)
    })
  })

  describe.skip('third', () => {
    // Depends on the optional addons/third plugin. Will be revisited if the plugin is installed.
    it.skip('logs in via third-party platform', async () => {
      // requires addons/third plugin
    })
  })

  describe('resetpwd', () => {
    it('resets password via mobile + SMS code (default type)', async () => {
      const u = await makeUser({ password: 'pw_old' })
      const code = '7788'
      await insertSmsCode(u.mobile, 'resetpwd', code)
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/resetpwd',
        form: { mobile: u.mobile, newpassword: 'pw_new_456', captcha: code },
      })
      expect(r.code).toBe(1)
      // new pw works for login
      const r2 = await http.json({
        method: 'POST',
        url: '/api/user/login',
        form: { account: u.username, password: 'pw_new_456' },
      })
      expect(r2.code).toBe(1)
    })

    it('resets password via email + EMS code (type != mobile)', async () => {
      const u = await makeUser({ password: 'pw_old_e' })
      const code = '8877'
      await insertEmsCode(u.email, 'resetpwd', code)
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/resetpwd',
        form: {
          type: 'email',
          email: u.email,
          newpassword: 'pw_new_eee',
          captcha: code,
        },
      })
      expect(r.code).toBe(1)
    })

    it('rejects unknown mobile', async () => {
      const mobile = '139' + String(Date.now()).slice(-8)
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/resetpwd',
        form: { mobile, newpassword: 'pw_new_xxx', captcha: '0000' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects short newpassword', async () => {
      const u = await makeUser()
      const code = '1100'
      await insertSmsCode(u.mobile, 'resetpwd', code)
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/resetpwd',
        form: { mobile: u.mobile, newpassword: 'p1', captcha: code },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects missing newpassword/captcha', async () => {
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/resetpwd',
        form: { mobile: '13800000001' },
      })
      expect(r.code).not.toBe(1)
    })

    it('rejects wrong captcha', async () => {
      const u = await makeUser()
      await insertSmsCode(u.mobile, 'resetpwd', '7777')
      const http = createHttpClient()
      const r = await http.json({
        method: 'POST',
        url: '/api/user/resetpwd',
        form: { mobile: u.mobile, newpassword: 'pw_new_abc', captcha: '0000' },
      })
      expect(r.code).not.toBe(1)
    })
  })
})
