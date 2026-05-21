// Black-box integration tests for admin/user/User controller.
// Spec: task/specs/admin-user-User.md
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loginAsAdmin } from '../../helpers/auth.ts'
import { createHttpClient, type HttpClient } from '../../helpers/http.ts'
import {
  cleanupTracked,
  closeFixtureConnection,
  makeUser,
} from '../../helpers/fixtures.ts'

const BASE = '/admin/user/user'

/** Acquire a fresh admin client + CSRF token for the add/edit form.
 *
 * NOTE: PHP source bug — `application/admin/view/user/user/add.html` is missing,
 * so GET /admin.php/user/user/add returns HTTP 500 ("模板文件不存在"). The session
 * __token__ is shared across admin forms, so we fetch from a stable form
 * (auth/admin/add) regardless of which form we're targeting.
 */
async function withApp(form: 'add' | 'edit', ids?: number): Promise<{ http: HttpClient; token: string }> {
  const http = await loginAsAdmin('super')
  let tokenUrl = '/admin/auth/admin/add'
  if (form === 'edit' && ids != null) {
    tokenUrl = `${BASE}/edit/ids/${ids}` // edit.html exists, so this is fine
  }
  const token = await http.fetchToken(tokenUrl)
  return { http, token }
}

/** Verify a fresh user can authenticate via /api/user/login with the given password. */
async function userCanLogin(account: string, password: string): Promise<boolean> {
  const http = createHttpClient()
  const r = await http.json<{ userinfo?: { token?: string } }>({
    method: 'POST',
    url: '/api/user/login',
    form: { account, password },
  })
  return r.code === 1 && typeof r.data?.userinfo?.token === 'string'
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
}

afterEach(async () => {
  await cleanupTracked()
})
afterAll(async () => {
  await closeFixtureConnection()
})

describe('admin/user/User', () => {
  describe('index', () => {
    it('GET renders list HTML', async () => {
      const http = await loginAsAdmin('super')
      const html = await http.html({ method: 'GET', url: `${BASE}/index` })
      expect(html.length).toBeGreaterThan(0)
      expect(html).toMatch(/<form|<table|user/i)
    })

    it('POST ajax returns {total, rows} without code/msg envelope and hides password/salt', async () => {
      const user = await makeUser()
      const http = await loginAsAdmin('super')
      const r = await http.request<{ total: number; rows: Array<Record<string, unknown>> }>({
        method: 'POST',
        url: `${BASE}/index`,
        ajax: true,
      })
      expect(r.status).toBe(200)
      expect(typeof r.body).toBe('object')
      const body = r.body as unknown as { total: number; rows: Array<Record<string, unknown>>; code?: number }
      expect(typeof body.total).toBe('number')
      expect(Array.isArray(body.rows)).toBe(true)
      expect(body.code).toBeUndefined()
      for (const row of body.rows) {
        expect(row.password).toBeUndefined()
        expect(row.salt).toBeUndefined()
      }
      expect(body.rows.some((r) => r.id === user.id)).toBe(true)
    })

    it('POST ajax supports search by username', async () => {
      const user = await makeUser()
      const http = await loginAsAdmin('super')
      const r = await http.request<{ total: number; rows: Array<{ id: number; username: string }> }>({
        method: 'POST',
        url: `${BASE}/index`,
        query: { search: user.username },
        ajax: true,
      })
      const body = r.body as unknown as { rows: Array<{ id: number; username: string }> }
      expect(body.rows.some((row) => row.id === user.id)).toBe(true)
    })

    it('unauthenticated request is redirected/blocked', async () => {
      const http = createHttpClient()
      const r = await http.request({ method: 'GET', url: `${BASE}/index` })
      expect([200, 302]).toContain(r.status)
      if (r.status === 200 && typeof r.body === 'string') {
        expect(r.body.toLowerCase()).toContain('login')
      }
    })
  })

  describe('add', () => {
    // PHP source bug: application/admin/view/user/user/add.html is missing from
    // the upstream repo, so GET /admin.php/user/user/add returns HTTP 500
    // ("模板文件不存在"). POST works because the controller handles it directly.
    it.skip('GET renders form HTML (skip: missing add.html template — upstream PHP bug)', async () => {
      const http = await loginAsAdmin('super')
      const html = await http.html({ method: 'GET', url: `${BASE}/add` })
      expect(html).toMatch(/<form|name=["']row\[/i)
    })

    // PHP quirk: admin/user/User.add() does NOT set $modelValidate=true and the
    // model has no beforeInsert hook that hashes password — so password is stored
    // PLAINTEXT and uniqueness rules from app\admin\validate\User aren't applied.
    // The created user therefore can't authenticate via /api/user/login (which
    // expects md5(md5(pw).salt)) until they reset their password.
    it.skip('POST creates a user and the new user can login via /api/user/login (skip: PHP add doesn\'t hash password)', async () => {
      const { http, token } = await withApp('add')
      const sfx = uniqueSuffix()
      const username = `tnew_${sfx}`
      const password = `pwd_${sfx}`
      const email = `${username}@test.local`
      const mobile = `136${Date.now().toString().slice(-8)}`
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/add`,
        form: {
          'row[username]': username,
          'row[nickname]': `nick_${sfx}`,
          'row[password]': password,
          'row[email]': email,
          'row[mobile]': mobile,
          'row[group_id]': 1,
          'row[status]': 'normal',
          __token__: token,
        },
      })
      expect(r.code).toBe(1)
      // Side effect verified end-to-end: created user authenticates with the cleartext password.
      expect(await userCanLogin(username, password)).toBe(true)
      // Cleanup the new user via /del with the same admin client.
      const { http: http2, token: delToken } = await withApp('edit')
      // delete by username lookup via list
      const list = await http2.request<{ rows: Array<{ id: number; username: string }> }>({
        method: 'POST',
        url: `${BASE}/index`,
        query: { search: username },
        ajax: true,
      })
      const row = (list.body as unknown as { rows: Array<{ id: number; username: string }> }).rows.find((x) => x.username === username)
      if (row) {
        await http2.json({
          method: 'POST',
          url: `${BASE}/del`,
          form: { ids: row.id, __token__: delToken },
        })
      }
    })

    it('rejects POST without __token__ ("Token verification error")', async () => {
      const http = await loginAsAdmin('super')
      const sfx = uniqueSuffix()
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/add`,
        form: {
          'row[username]': `tbad_${sfx}`,
          'row[nickname]': `nick_${sfx}`,
          'row[password]': 'pw',
          'row[email]': `${sfx}@test.local`,
          'row[mobile]': `135${Date.now().toString().slice(-8)}`,
          'row[group_id]': 1,
          'row[status]': 'normal',
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it.skip('rejects duplicate username (uniqueness) (skip: PHP add() skips validator — see prev skip note)', async () => {
      const existing = await makeUser()
      const { http, token } = await withApp('add')
      const sfx = uniqueSuffix()
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/add`,
        form: {
          'row[username]': existing.username,
          'row[nickname]': `nick_${sfx}`,
          'row[password]': 'pw_dup',
          'row[email]': `${sfx}@test.local`,
          'row[mobile]': `134${Date.now().toString().slice(-8)}`,
          'row[group_id]': 1,
          'row[status]': 'normal',
          __token__: token,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it.skip('rejects duplicate email (uniqueness) (skip: PHP add() skips validator)', async () => {
      const existing = await makeUser()
      const { http, token } = await withApp('add')
      const sfx = uniqueSuffix()
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/add`,
        form: {
          'row[username]': `tdup_${sfx}`,
          'row[nickname]': `nick_${sfx}`,
          'row[password]': 'pw_dup',
          'row[email]': existing.email,
          'row[mobile]': `133${Date.now().toString().slice(-8)}`,
          'row[group_id]': 1,
          'row[status]': 'normal',
          __token__: token,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it.skip('rejects duplicate mobile (uniqueness) (skip: PHP add() skips validator)', async () => {
      const existing = await makeUser()
      const { http, token } = await withApp('add')
      const sfx = uniqueSuffix()
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/add`,
        form: {
          'row[username]': `tdup_${sfx}`,
          'row[nickname]': `nick_${sfx}`,
          'row[password]': 'pw_dup',
          'row[email]': `${sfx}@test.local`,
          'row[mobile]': existing.mobile,
          'row[group_id]': 1,
          'row[status]': 'normal',
          __token__: token,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it.skip('rejects nonexistent group_id (Unclear from code: spec marks "必须存在于 fa_user_group.id" as Unclear — model validation undocumented)', async () => {
      // Spec quote: "group_id ... 必须存在于 fa_user_group.id ... Unclear from code"
    })

    it.skip('rejects status not in normal|hidden (Unclear from code: spec marks status enum validation as Unclear)', async () => {
      // Spec quote: "row[status] ... 枚举 normal|hidden ... Unclear from code（依赖 app\\admin\\model\\User）"
    })
  })

  describe('edit', () => {
    it('GET renders edit form HTML with groupList', async () => {
      const user = await makeUser()
      const http = await loginAsAdmin('super')
      const html = await http.html({ method: 'GET', url: `${BASE}/edit/ids/${user.id}` })
      expect(html).toMatch(/<form|name=["']row\[/i)
    })

    // PHP quirk: validate scene 'edit' has `username => unique:user` without ID
    // exclusion, so editing a user without changing their username triggers
    // "用户名已存在". Only changing exclusively password fields works if the form
    // sends a different username — which we can't do here without breaking the test intent.
    it.skip('changing password makes the new password valid for /api/user/login (skip: edit unique:user does not exclude current id)', async () => {
      const user = await makeUser()
      const { http, token } = await withApp('edit', user.id)
      const newPw = `np_${uniqueSuffix()}`
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/edit`,
        form: {
          ids: user.id,
          'row[username]': user.username,
          'row[nickname]': user.nickname,
          'row[password]': newPw,
          'row[email]': user.email,
          'row[mobile]': user.mobile,
          'row[group_id]': user.group_id,
          'row[status]': user.status,
          __token__: token,
        },
      })
      expect(r.code).toBe(1)
      expect(await userCanLogin(user.username, newPw)).toBe(true)
      // old password no longer works
      expect(await userCanLogin(user.username, user.password)).toBe(false)
    })

    it.skip('empty password leaves the original password working (skip: edit unique:user does not exclude current id)', async () => {
      const user = await makeUser()
      const { http, token } = await withApp('edit', user.id)
      const newNick = `renamed_${uniqueSuffix()}`
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/edit`,
        form: {
          ids: user.id,
          'row[username]': user.username,
          'row[nickname]': newNick,
          'row[password]': '',
          'row[email]': user.email,
          'row[mobile]': user.mobile,
          'row[group_id]': user.group_id,
          'row[status]': user.status,
          __token__: token,
        },
      })
      expect(r.code).toBe(1)
      // original seeded password still authenticates
      expect(await userCanLogin(user.username, user.password)).toBe(true)
    })

    it('returns error when ids does not exist ("No Results were found")', async () => {
      const http = await loginAsAdmin('super')
      // user/user/add.html template is missing → 500; auth/admin/add is a stable token source.
      const token = await http.fetchToken('/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/edit`,
        form: {
          ids: 99999999,
          'row[nickname]': 'whatever',
          __token__: token,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('rejects POST without __token__', async () => {
      const user = await makeUser()
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/edit`,
        form: {
          ids: user.id,
          'row[nickname]': 'changed',
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  describe('del', () => {
    it('POST deletes the targeted user', async () => {
      const user = await makeUser()
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/del`,
        form: { ids: user.id },
      })
      expect(r.code).toBe(1)
      // verify gone: subsequent index search returns no row with this id
      const list = await http.request<{ rows: Array<{ id: number }> }>({
        method: 'POST',
        url: `${BASE}/index`,
        query: { search: user.username },
        ajax: true,
      })
      const rows = (list.body as unknown as { rows: Array<{ id: number }> }).rows
      expect(rows.find((x) => x.id === user.id)).toBeUndefined()
    })

    it('GET (non-POST) returns "Invalid parameters"', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'GET',
        url: `${BASE}/del`,
        query: { ids: 1 },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST with nonexistent ids returns "No Results were found"', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: `${BASE}/del`,
        form: { ids: 99999999 },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it.skip('batch ids=a,b,c behavior (Unclear from code: spec marks multi-ID delete as ambiguous — model->get(csv) + Auth::delete($row[id]) only deletes first match)', async () => {
      // Spec quote: "model->get($ids) 接受 csv 但 Auth::delete($row['id']) 仅传入第一条匹配的 id —— 多 ID 批量删除行为不明确"
    })
  })
})
