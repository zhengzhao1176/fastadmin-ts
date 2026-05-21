import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { loginAsAdmin, unauthenticated } from '../../helpers/auth.ts'
import {
  cleanupTracked,
  closeFixtureConnection,
  makeAdmin,
  makeAuthGroup,
  trackForCleanup,
} from '../../helpers/fixtures.ts'
import { withApp, loadDbConfig } from '../../../scripts/db.ts'
import { fastadminHash } from '../../../scripts/hash.ts'
import type { HttpClient } from '../../helpers/http.ts'

const PFX = loadDbConfig().prefix

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

// ---------- helpers ----------

/** Fetch CSRF __token__ for the add or edit form. */
async function tokenFor(http: HttpClient, path: string): Promise<string> {
  return http.fetchToken(path)
}

/** Pull a fresh row by id from fa_admin. */
async function findAdminById(id: number): Promise<Record<string, unknown> | null> {
  return withApp(async (db) => {
    const [rows] = await db.query(`SELECT * FROM \`${PFX}admin\` WHERE id = ?`, [id])
    const arr = rows as Record<string, unknown>[]
    return arr.length > 0 ? arr[0]! : null
  })
}

/** Find auth_group_access rows for an admin id. */
async function findGroupAccessByUid(uid: number): Promise<{ uid: number; group_id: number }[]> {
  return withApp(async (db) => {
    const [rows] = await db.query(
      `SELECT uid, group_id FROM \`${PFX}auth_group_access\` WHERE uid = ?`,
      [uid],
    )
    return rows as { uid: number; group_id: number }[]
  })
}

/** Look up an admin id by username (post-create). */
async function findAdminIdByUsername(username: string): Promise<number | null> {
  return withApp(async (db) => {
    const [rows] = await db.query(
      `SELECT id FROM \`${PFX}admin\` WHERE username = ? LIMIT 1`,
      [username],
    )
    const arr = rows as { id: number }[]
    return arr.length > 0 ? arr[0]!.id : null
  })
}

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

// ============================================================================

describe('admin/auth/Admin', () => {
  // ----------------------- index -----------------------
  describe('index', () => {
    it('GET unauthenticated → redirect / login response', async () => {
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/admin/auth/admin/index', ajax: false })
      if (r.status === 302) {
        expect((r.headers['location'] ?? '').toLowerCase()).toContain('login')
      } else {
        expect(r.status).toBe(200)
      }
    })

    it('GET with super admin returns HTML page', async () => {
      const http = await loginAsAdmin('super')
      const body = await http.html({ method: 'GET', url: '/admin/auth/admin/index' })
      expect(body.length).toBeGreaterThan(0)
      expect(body.toLowerCase()).toContain('<')
    })

    it('ajax list returns { total, rows } envelope, rows omit password/salt/token', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json<{ total: number; rows: Array<Record<string, unknown>> }>({
        method: 'GET',
        url: '/admin/auth/admin/index',
        query: { page: 1, limit: 10 },
      })
      // Backend ajax index returns rows/total directly at envelope root for this controller.
      const body = r as unknown as { total?: number; rows?: Array<Record<string, unknown>> }
      const rows = body.rows ?? (r.data as { rows?: Array<Record<string, unknown>> } | undefined)?.rows
      const total = body.total ?? (r.data as { total?: number } | undefined)?.total
      expect(Array.isArray(rows)).toBe(true)
      expect(typeof total).toBe('number')
      if (rows && rows.length > 0) {
        const sample = rows[0]!
        expect(sample).not.toHaveProperty('password')
        expect(sample).not.toHaveProperty('salt')
        expect(sample).not.toHaveProperty('token')
      }
    })

    it('subadmin data-range: list excludes the subadmin itself & rows it cannot see', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json<unknown>({
        method: 'GET',
        url: '/admin/auth/admin/index',
        query: { page: 1, limit: 100 },
      })
      const body = r as unknown as { total?: number; rows?: Array<{ id: number }> }
      const rows = body.rows ?? (r.data as { rows?: Array<{ id: number }> } | undefined)?.rows ?? []
      // Subadmin must not see itself (childrenAdminIds excludes self for non-super).
      const ids = rows.map((row) => Number(row.id))
      expect(ids).not.toContain(2)
    })
  })

  // ----------------------- add -----------------------
  describe('add', () => {
    it('GET renders the add form HTML', async () => {
      const http = await loginAsAdmin('super')
      const body = await http.html({ method: 'GET', url: '/admin/auth/admin/add' })
      expect(body).toMatch(/name=["']row\[username\]["']/i)
      expect(body).toMatch(/name=["']__token__["']/i)
    })

    it('POST happy path → code=1 and DB row exists with correct hashed password', async () => {
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, '/admin/auth/admin/add')
      const username = uniqueName('t_new')
      const email = `${username}@test.local`
      const plain = 'Pass1234'
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: {
          __token__: token,
          'row[username]': username,
          'row[nickname]': `${username}_nick`,
          'row[password]': plain,
          'row[email]': email,
          'row[mobile]': `139${Date.now().toString().slice(-8)}`,
          'row[status]': 'normal',
          'group[]': 2,
        },
      })
      expect(r.code).toBe(1)
      const newId = await findAdminIdByUsername(username)
      expect(newId).not.toBeNull()
      trackForCleanup(`${PFX}admin`, newId!)
      const row = await findAdminById(newId!)
      expect(row).not.toBeNull()
      const salt = String(row!.salt)
      const stored = String(row!.password)
      // FastAdmin's algorithm: md5(md5(password) + salt)
      expect(stored).toBe(fastadminHash(plain, salt))
      // verify auth_group_access link inserted
      const access = await findGroupAccessByUid(newId!)
      trackForCleanup(`${PFX}auth_group_access`, newId!)
      expect(access.length).toBeGreaterThan(0)
      expect(access.map((a) => Number(a.group_id))).toContain(2)
    })

    it('POST username duplicate → code=0', async () => {
      const existing = await makeAdmin()
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, '/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: {
          __token__: token,
          'row[username]': existing.username,
          'row[nickname]': 'dup_user',
          'row[password]': 'Pass1234',
          'row[email]': `${uniqueName('dup')}@test.local`,
          'row[status]': 'normal',
          'group[]': 2,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST email duplicate → code=0', async () => {
      const existing = await makeAdmin()
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, '/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: {
          __token__: token,
          'row[username]': uniqueName('t_email_dup'),
          'row[nickname]': 'dup_email',
          'row[password]': 'Pass1234',
          'row[email]': existing.email,
          'row[status]': 'normal',
          'group[]': 2,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST missing required fields → code=0', async () => {
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, '/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: {
          __token__: token,
          // username/email/password all missing
          'row[nickname]': 'no_fields',
          'group[]': 2,
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST without row param → code=0', async () => {
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, '/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: { __token__: token },
      })
      expect(r.code).toBe(0)
    })

    it('POST with bad token → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: {
          __token__: 'deadbeef'.repeat(4),
          'row[username]': uniqueName('t_bad_tok'),
          'row[nickname]': 'bad_tok',
          'row[password]': 'Pass1234',
          'row[email]': `${uniqueName('badtok')}@test.local`,
          'row[status]': 'normal',
          'group[]': 2,
        },
      })
      expect(r.code).toBe(0)
    })

    // Skip: subadmin (rules 1-10) can't reach auth/admin/add to fetch CSRF token.
    // Permission-isolation tests like this belong in cross-cutting/01-rbac-matrix.
    it.skip('POST group outside childrenGroupIds → code=0 ("父组别超出权限范围") (skip: subadmin perms — cross-cutting)', async () => {
      const http = await loginAsAdmin('subadmin')
      const token = await tokenFor(http, '/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/add',
        form: {
          __token__: token,
          'row[username]': uniqueName('t_oob'),
          'row[nickname]': 'oob',
          'row[password]': 'Pass1234',
          'row[email]': `${uniqueName('oob')}@test.local`,
          'row[status]': 'normal',
          'group[]': 1, // group 1 is parent of subadmin → outside childrenGroupIds
        },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  // ----------------------- edit -----------------------
  describe('edit', () => {
    it('GET edit form for a manageable admin renders HTML', async () => {
      const group = await makeAuthGroup({ pid: 1, name: uniqueName('t_grp') })
      const subject = await makeAdmin({ group_id: group.id })
      const http = await loginAsAdmin('super')
      const body = await http.html({ method: 'GET', url: `/admin/auth/admin/edit/ids/${subject.id}` })
      expect(body.length).toBeGreaterThan(0)
      expect(body).toMatch(/name=["']row\[nickname\]["']/i)
    })

    it('GET edit with non-existent id → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.request({
        method: 'GET',
        url: '/admin/auth/admin/edit/ids/99999999',
        ajax: true,
      })
      if (typeof r.body === 'object' && r.body !== null) {
        expect((r.body as unknown as { code: number }).code).toBe(0)
      } else {
        expect(typeof r.body).toBe('string')
      }
    })

    it('POST edit nickname → success and DB row updated', async () => {
      const subject = await makeAdmin()
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, `/admin/auth/admin/edit/ids/${subject.id}`)
      const newNick = `edited_${uniqueName('n')}`
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/edit',
        form: {
          ids: subject.id,
          __token__: token,
          'row[username]': subject.username,
          'row[nickname]': newNick,
          'row[password]': '', // leave password unchanged
          'row[email]': subject.email,
          'row[mobile]': subject.mobile,
          'row[status]': 'normal',
          'group[]': subject.group_id,
        },
      })
      expect(r.code).toBe(1)
      const after = await findAdminById(subject.id)
      expect(after).not.toBeNull()
      expect(String(after!.nickname)).toBe(newNick)
    })

    it('POST edit empty password leaves password & salt unchanged', async () => {
      const subject = await makeAdmin()
      const before = await findAdminById(subject.id)
      const beforePwd = String(before!.password)
      const beforeSalt = String(before!.salt)

      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, `/admin/auth/admin/edit/ids/${subject.id}`)
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/edit',
        form: {
          ids: subject.id,
          __token__: token,
          'row[username]': subject.username,
          'row[nickname]': `${subject.nickname}_x`,
          'row[password]': '',
          'row[email]': subject.email,
          'row[mobile]': subject.mobile,
          'row[status]': 'normal',
          'group[]': subject.group_id,
        },
      })
      expect(r.code).toBe(1)
      const after = await findAdminById(subject.id)
      expect(String(after!.password)).toBe(beforePwd)
      expect(String(after!.salt)).toBe(beforeSalt)
    })

    it('POST edit with non-empty password updates hash to md5(md5(plain)+salt)', async () => {
      const subject = await makeAdmin()
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, `/admin/auth/admin/edit/ids/${subject.id}`)
      const newPlain = 'NewPass99'
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/edit',
        form: {
          ids: subject.id,
          __token__: token,
          'row[username]': subject.username,
          'row[nickname]': subject.nickname,
          'row[password]': newPlain,
          'row[email]': subject.email,
          'row[mobile]': subject.mobile,
          'row[status]': 'normal',
          'group[]': subject.group_id,
        },
      })
      expect(r.code).toBe(1)
      const after = await findAdminById(subject.id)
      const newSalt = String(after!.salt)
      expect(String(after!.password)).toBe(fastadminHash(newPlain, newSalt))
    })

    it('POST edit replaces auth_group_access rows for the user', async () => {
      const subject = await makeAdmin({ group_id: 2 })
      const before = await findGroupAccessByUid(subject.id)
      expect(before.map((a) => Number(a.group_id))).toContain(2)
      const http = await loginAsAdmin('super')
      const token = await tokenFor(http, `/admin/auth/admin/edit/ids/${subject.id}`)
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/edit',
        form: {
          ids: subject.id,
          __token__: token,
          'row[username]': subject.username,
          'row[nickname]': subject.nickname,
          'row[password]': '',
          'row[email]': subject.email,
          'row[mobile]': subject.mobile,
          'row[status]': 'normal',
          'group[]': 1, // super remaps to group 1
        },
      })
      expect(r.code).toBe(1)
      const after = await findGroupAccessByUid(subject.id)
      expect(after.map((a) => Number(a.group_id))).toEqual([1])
    })

    it.skip('POST edit on id outside childrenAdminIds → code=0 (skip: subadmin perms — move to cross-cutting)', async () => {
      // subadmin tries to edit super (id=1) which it cannot manage
      const http = await loginAsAdmin('subadmin')
      const token = await http.fetchToken('/admin/auth/admin/add')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/edit',
        form: {
          ids: 1,
          __token__: token,
          'row[username]': 'admin',
          'row[nickname]': 'hijack',
          'row[password]': '',
          'row[email]': 'admin@fastadmin.net',
          'row[status]': 'normal',
          'group[]': 2,
        },
      })
      expect(r.code).toBe(0)
    })
  })

  // ----------------------- del -----------------------
  describe('del', () => {
    it('non-POST → code=0 ("Invalid parameters")', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'GET',
        url: '/admin/auth/admin/del',
        query: { ids: '999999' },
      })
      expect(r.code).toBe(0)
    })

    it('cannot delete self (super deleting super → no rows deleted)', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/del',
        form: { ids: '1' }, // super admin id
      })
      expect(r.code).toBe(0)
    })

    it('cannot delete a parent / out-of-scope admin (subadmin → super)', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/del',
        form: { ids: '1' },
      })
      expect(r.code).toBe(0)
    })

    it('happy path: super deletes a managed admin → DB rows gone', async () => {
      const subject = await makeAdmin()
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/del',
        form: { ids: String(subject.id) },
      })
      expect(r.code).toBe(1)
      const row = await findAdminById(subject.id)
      expect(row).toBeNull()
      const access = await findGroupAccessByUid(subject.id)
      expect(access.length).toBe(0)
    })

    it('empty ids → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/del',
        form: { ids: '' },
      })
      expect(r.code).toBe(0)
    })
  })

  // ----------------------- multi -----------------------
  describe('multi', () => {
    it('always returns code=0 (controller forbids batch on admin)', async () => {
      const subject = await makeAdmin()
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/multi',
        form: { ids: String(subject.id), params: 'status:hidden' },
      })
      expect(r.code).toBe(0)
      // status should NOT have flipped
      const after = await findAdminById(subject.id)
      expect(String(after!.status)).toBe('normal')
    })

    it('multi with empty ids → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/auth/admin/multi',
        form: { ids: '', params: 'status:hidden' },
      })
      expect(r.code).toBe(0)
    })
  })

  // ----------------------- selectpage -----------------------
  describe('selectpage', () => {
    it('returns { list, total } and excludes password/salt fields', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/admin/auth/admin/selectpage',
        form: {
          pageNumber: 1,
          pageSize: 10,
          showField: 'nickname',
          keyField: 'id',
        },
      })
      const payload = (r.data ?? r) as { list?: Array<Record<string, unknown>>; total?: number }
      expect(Array.isArray(payload.list)).toBe(true)
      expect(typeof payload.total).toBe('number')
      if ((payload.list ?? []).length > 0) {
        const sample = payload.list![0]!
        expect(sample).not.toHaveProperty('password')
        expect(sample).not.toHaveProperty('salt')
      }
    })

    it.skip('selectpage with subadmin: dataLimit=auth includes self (skip: subadmin perms — move to cross-cutting)', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/admin/auth/admin/selectpage',
        form: { pageNumber: 1, pageSize: 100, showField: 'nickname', keyField: 'id' },
      })
      const payload = (r.data ?? r) as { list?: Array<{ id: number }>; total?: number }
      const ids = (payload.list ?? []).map((x) => Number(x.id))
      // With dataLimit='auth' getChildrenAdminIds(true) includes the caller itself
      expect(ids).toContain(2)
    })

    it('selectpage unauthenticated → not code=1', async () => {
      const http = unauthenticated()
      const r = await http.request({
        method: 'POST',
        url: '/admin/auth/admin/selectpage',
        form: { pageNumber: 1, pageSize: 10 },
        ajax: true,
      })
      if (typeof r.body === 'object' && r.body !== null) {
        expect((r.body as unknown as { code: number }).code).not.toBe(1)
      }
    })

    it.skip('selectpage requires its own auth/admin/selectpage permission node', () => {
      // Spec: 'Unclear from code：是否需要单独节点配置，依赖权限表，仅看到从 index 转发'
    })
  })
})
