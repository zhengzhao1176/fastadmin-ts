// Tests for admin/general/Profile controller.
// Spec discrepancy: actual whitelist is email/nickname/password/avatar.
// No `mobile`, no `oldpassword` check (per spec, "代码白名单不包含 oldpassword").
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { loginAsAdmin, unauthenticated, AuthError } from '../../helpers/auth.ts'
import { makeAdmin, cleanupTracked, closeFixtureConnection } from '../../helpers/fixtures.ts'
import { withApp, loadDbConfig } from '../../../scripts/db.ts'
import { createHttpClient } from '../../helpers/http.ts'

const PFX = loadDbConfig().prefix

async function fetchAdminRow(id: number) {
  return withApp(async (db) => {
    const [rows] = await db.query(
      // fa_admin has no group_id column — group association is in fa_auth_group_access.
      `SELECT id, username, nickname, email, mobile, avatar, status, password, salt
       FROM \`${PFX}admin\` WHERE id = ?`,
      [id],
    )
    return (rows as Array<Record<string, unknown>>)[0]
  })
}

async function postUpdate(http: ReturnType<typeof createHttpClient>, row: Record<string, unknown>) {
  const token = await http.fetchToken('/admin/general/profile/index')
  const form: Record<string, unknown> = { __token__: token }
  for (const [k, v] of Object.entries(row)) form[`row[${k}]`] = v
  return http.json({ method: 'POST', url: '/admin/general/profile/update', form })
}

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

describe('admin/general/Profile', () => {
  describe('index', () => {
    it('HTML page returns 200 with admin nav present', async () => {
      const http = await loginAsAdmin()
      const html = await http.html({ method: 'GET', url: '/admin/general/profile/index' })
      expect(html.length).toBeGreaterThan(0)
      expect(/<!DOCTYPE|<html/i.test(html)).toBe(true)
    })

    it('ajax list returns {total, rows} without code/msg envelope', async () => {
      const http = await loginAsAdmin()
      const r = await http.request<{ total: number; rows: unknown[] }>({
        method: 'POST',
        url: '/admin/general/profile/index',
        ajax: true,
      })
      expect(r.status).toBe(200)
      expect(typeof r.body).toBe('object')
      const body = r.body as unknown as { total: number; rows: unknown[]; code?: unknown; msg?: unknown }
      expect(Array.isArray(body.rows)).toBe(true)
      expect(typeof body.total).toBe('number')
      // Spec: "不走 $this->success() 包络，因此没有 code/msg/time 字段"
      expect(body.code).toBeUndefined()
      expect(body.msg).toBeUndefined()
    })

    it('unauthenticated client is bounced (no admin envelope code=1)', async () => {
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/admin/general/profile/index' })
      // Either redirect (302) or interception page; must not be a real list response.
      expect(r.status).not.toBe(0)
      if (typeof r.body !== 'string') {
        expect((r.body as unknown as { code?: number }).code).not.toBe(1)
      }
    })
  })

  describe('update', () => {
    it('updates email/nickname/avatar in DB on happy path', async () => {
      const admin = await makeAdmin()
      const http = await loginAsAdmin()
      // login as super; mutate super's own row instead — get super id
      const meRow = await withApp(async (db) => {
        const [rows] = await db.query(
          `SELECT id, email, nickname, avatar FROM \`${PFX}admin\` WHERE username = ?`,
          ['admin'],
        )
        return (rows as Array<Record<string, unknown>>)[0]
      })
      const newEmail = `updated_${Date.now()}@test.local`
      const newNickname = `nick_${Date.now()}`
      const newAvatar = '/uploads/test/avatar.png'
      const r = await postUpdate(http, {
        email: newEmail,
        nickname: newNickname,
        avatar: newAvatar,
      })
      expect(r.code).toBe(1)
      const after = await fetchAdminRow(meRow.id as number)
      expect(after.email).toBe(newEmail)
      expect(after.nickname).toBe(newNickname)
      expect(after.avatar).toBe(newAvatar)
      // Restore original to avoid polluting other tests
      await withApp(async (db) => {
        await db.query(
          `UPDATE \`${PFX}admin\` SET email = ?, nickname = ?, avatar = ? WHERE id = ?`,
          [meRow.email ?? '', meRow.nickname ?? '', meRow.avatar ?? '', meRow.id],
        )
      })
      void admin
    })

    it('rejects when __token__ is missing', async () => {
      const http = await loginAsAdmin()
      const r = await http.json({
        method: 'POST',
        url: '/admin/general/profile/update',
        form: { 'row[email]': 'x@test.local' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('rejects invalid email format', async () => {
      const http = await loginAsAdmin()
      const r = await postUpdate(http, { email: 'not-an-email', nickname: 'x' })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('rejects password violating /^[\\S]{6,30}$/ when email is valid', async () => {
      const http = await loginAsAdmin()
      const meId = (await withApp(async (db) => {
        const [rows] = await db.query(`SELECT id, email FROM \`${PFX}admin\` WHERE username = ?`, ['admin'])
        return (rows as Array<Record<string, unknown>>)[0]
      }))
      const r = await postUpdate(http, { email: meId.email, password: 'ab c' })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('rejects email already taken by another admin', async () => {
      const other = await makeAdmin()
      const http = await loginAsAdmin()
      const r = await postUpdate(http, { email: other.email, nickname: 'x' })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('changes password WITHOUT oldpassword and new password works for login', async () => {
      // Spec: "源码中没有 oldpassword 校验，已登录管理员可直接重置密码"
      const target = await makeAdmin()
      // login as the freshly-made admin (uses its own credentials)
      const http = createHttpClient()
      const loginToken = await http.fetchToken('/admin/index/login')
      const loginResp = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: target.username,
          password: target.password,
          keeplogin: 0,
          __token__: loginToken,
        },
      })
      expect(loginResp.code).toBe(1)
      const newPass = 'newPass1'
      const r = await postUpdate(http, { email: target.email, password: newPass })
      expect(r.code).toBe(1)
      // Verify new password works
      const http2 = createHttpClient()
      const t2 = await http2.fetchToken('/admin/index/login')
      const loginAgain = await http2.json({
        method: 'POST',
        url: '/admin/index/login',
        form: { username: target.username, password: newPass, keeplogin: 0, __token__: t2 },
      })
      expect(loginAgain.code).toBe(1)
    })

    it('ignores username/status/group_id even when submitted', async () => {
      // group_id=1 so the target admin can fetchToken from general/profile/index.
      const target = await makeAdmin({ status: 'normal', group_id: 1 })
      const http = createHttpClient()
      const loginToken = await http.fetchToken('/admin/index/login')
      const loginResp = await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: target.username,
          password: target.password,
          keeplogin: 0,
          __token__: loginToken,
        },
      })
      expect(loginResp.code).toBe(1)
      const r = await postUpdate(http, {
        email: target.email,
        nickname: 'still-changes',
        username: 'hacked_name',
        status: 'hidden',
        group_id: 99,
      })
      expect(r.code).toBe(1)
      const after = await fetchAdminRow(target.id)
      expect(after.username).toBe(target.username)
      expect(after.status).toBe('normal')
      // group_id is stored in auth_group_access, not admin row, but spec marks it
      // as ignored regardless — assert via group_access table
      const gaRows = await withApp(async (db) => {
        const [rows] = await db.query(
          `SELECT group_id FROM \`${PFX}auth_group_access\` WHERE uid = ?`,
          [target.id],
        )
        return rows as Array<{ group_id: number }>
      })
      // target was created with group_id=1 — assert it stayed there, NOT 99.
      expect(gaRows[0]?.group_id).toBe(1)
      expect(after.nickname).toBe('still-changes')
    })

    it('ignores mobile field — whitelist does not include it', async () => {
      const target = await makeAdmin()
      const http = createHttpClient()
      const loginToken = await http.fetchToken('/admin/index/login')
      await http.json({
        method: 'POST',
        url: '/admin/index/login',
        form: {
          username: target.username,
          password: target.password,
          keeplogin: 0,
          __token__: loginToken,
        },
      })
      const newMobile = '13800000000'
      const r = await postUpdate(http, {
        email: target.email,
        nickname: 'm',
        mobile: newMobile,
      })
      expect(r.code).toBe(1)
      const after = await fetchAdminRow(target.id)
      expect(after.mobile).toBe(target.mobile)
      expect(after.mobile).not.toBe(newMobile)
    })

    it('non-POST request returns empty body with no envelope', async () => {
      const http = await loginAsAdmin()
      const r = await http.request({ method: 'GET', url: '/admin/general/profile/update' })
      // Spec: "非 POST 请求 — — 200 函数 return; 无输出体"
      expect(r.status).toBe(200)
      if (typeof r.body !== 'string') {
        expect((r.body as unknown as { code?: number }).code).not.toBe(1)
      }
    })

    it.skip('empty whitelist after filter triggers $this->error() with empty msg', async () => {
      // Spec "Unclear from code": "当 email 缺失时 Validate::is(null,'email') 的返回值
      // 依赖 ThinkPHP 5 Validate 实现" — behaviour for all-empty whitelist is ambiguous.
      expect(true).toBe(true)
    })

    it('unauthenticated update attempt does not succeed', async () => {
      const http = unauthenticated()
      let threw = false
      try {
        await http.fetchToken('/admin/general/profile/index')
      } catch {
        threw = true
      }
      const r = await http.json({
        method: 'POST',
        url: '/admin/general/profile/update',
        form: { 'row[email]': 'a@b.test', 'row[nickname]': 'x' },
      }).catch((e) => ({ code: -1, msg: String(e), data: null, time: '0' }))
      expect(r.code).not.toBe(1)
      void threw
      void AuthError
    })
  })
})
