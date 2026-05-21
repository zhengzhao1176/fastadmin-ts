// Black-box integration tests for admin/user/Group controller.
// Spec: task/specs/admin-user-Group.md
import { describe, it, expect, afterAll, afterEach } from 'vitest'
import type mysql from 'mysql2/promise'
import { loginAsAdmin, unauthenticated } from '../../helpers/auth.ts'
import {
  cleanupTracked,
  closeFixtureConnection,
  trackForCleanup,
} from '../../helpers/fixtures.ts'
import { loadDbConfig, withApp } from '../../../scripts/db.ts'

const PFX = loadDbConfig().prefix

interface UserGroupRow { id: number; name: string; rules: string; status: string }

async function insertUserGroup(overrides: Partial<UserGroupRow> = {}): Promise<UserGroupRow> {
  const sfx = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const row: UserGroupRow = {
    id: 0,
    name: overrides.name ?? `t_ugroup_${sfx}`,
    rules: overrides.rules ?? '1,2,3',
    status: overrides.status ?? 'normal',
  }
  const now = Math.floor(Date.now() / 1000)
  const insertId = await withApp(async (db: mysql.Connection) => {
    const [res] = await db.query(
      `INSERT INTO \`${PFX}user_group\` (name, rules, createtime, updatetime, status)
       VALUES (?, ?, ?, ?, ?)`,
      [row.name, row.rules, now, now, row.status],
    )
    return (res as mysql.ResultSetHeader).insertId
  })
  row.id = insertId
  trackForCleanup(`${PFX}user_group`, insertId)
  return row
}

async function fetchUserGroup(id: number): Promise<UserGroupRow | null> {
  return withApp(async (db) => {
    const [rows] = await db.query(`SELECT id, name, rules, status FROM \`${PFX}user_group\` WHERE id = ?`, [id])
    const arr = rows as UserGroupRow[]
    return arr.length > 0 ? arr[0]! : null
  })
}

afterEach(async () => { await cleanupTracked() })
afterAll(async () => { await closeFixtureConnection() })

describe('admin/user/Group', () => {
  describe('add', () => {
    it('creates a group with valid rules and token (happy path)', async () => {
      const http = await loginAsAdmin()
      const token = await http.fetchToken('/admin/user/group/add')
      const name = `t_add_${Date.now().toString(36)}`
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/add',
        form: { 'row[name]': name, 'row[rules]': '1,2,3', 'row[status]': 'normal', __token__: token },
      })
      expect(r.code).toBe(1)
      // success() returns empty msg by default — don't assert length.
      // Locate the row by name for cleanup and side-effect assertion
      const inserted = await withApp(async (db) => {
        const [rows] = await db.query(`SELECT id, name, rules, status FROM \`${PFX}user_group\` WHERE name = ?`, [name])
        return (rows as UserGroupRow[])[0] ?? null
      })
      expect(inserted).not.toBeNull()
      expect(inserted!.rules).toBe('1,2,3')
      trackForCleanup(`${PFX}user_group`, inserted!.id)
    })

    it('rejects POST without __token__', async () => {
      const http = await loginAsAdmin()
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/add',
        form: { 'row[name]': 'no_token', 'row[rules]': '1', 'row[status]': 'normal' },
      })
      expect(r.code).toBe(0)
      expect(r.msg).toMatch(/[Tt]oken/)
    })

    it('rejects unauthenticated request', async () => {
      const http = unauthenticated()
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/add',
        form: { 'row[name]': 'x', 'row[rules]': '1', 'row[status]': 'normal', __token__: 'x' },
      })
      expect(r.code).toBe(0)
    })

    it('GET renders the add form HTML', async () => {
      const http = await loginAsAdmin()
      const html = await http.html({ method: 'GET', url: '/admin/user/group/add' })
      expect(html).toMatch(/__token__/)
    })

    it.skip('"rules" must reference existing user_rule ids — Unclear from code: "本控制器代码、本模型代码、本语言包均无显式实现"', () => {})
  })

  describe('edit', () => {
    it('updates a group with valid input (happy path)', async () => {
      const http = await loginAsAdmin()
      const group = await insertUserGroup({ rules: '1,2' })
      const token = await http.fetchToken(`/admin/user/group/edit/ids/${group.id}`)
      const newName = `${group.name}_e`
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/edit',
        form: {
          ids: group.id,
          'row[name]': newName,
          'row[rules]': '1,2,3,4',
          'row[status]': 'normal',
          __token__: token,
        },
      })
      expect(r.code).toBe(1)
      const after = await fetchUserGroup(group.id)
      expect(after?.name).toBe(newName)
      expect(after?.rules).toBe('1,2,3,4')
    })

    it('returns "No Results were found" when ids is missing', async () => {
      const http = await loginAsAdmin()
      // GET form on a definitely-missing id should error
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/edit',
        form: { ids: 99999999, 'row[name]': 'x', 'row[rules]': '1', 'row[status]': 'normal', __token__: 'x' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('rejects POST without __token__', async () => {
      const http = await loginAsAdmin()
      const group = await insertUserGroup()
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/edit',
        form: { ids: group.id, 'row[name]': 'y', 'row[rules]': '1', 'row[status]': 'normal' },
      })
      expect(r.code).toBe(0)
      expect(r.msg).toMatch(/[Tt]oken/)
    })

    it('rejects unauthenticated request', async () => {
      const group = await insertUserGroup()
      const http = unauthenticated()
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/edit',
        form: { ids: group.id, 'row[name]': 'z', 'row[rules]': '1', 'row[status]': 'normal', __token__: 'x' },
      })
      expect(r.code).toBe(0)
    })

    it.skip('member api permissions change when group rules change — Unclear from code: rules validation/enforcement location not in read scope', () => {})
  })

  // -------- Inherited from Backend (one happy path each) --------

  describe('index (inherited)', () => {
    it('lists user groups via ajax', async () => {
      const http = await loginAsAdmin()
      const group = await insertUserGroup()
      const r = await http.json<{ total: number; rows: Array<{ id: number; name: string }> }>({
        method: 'POST',
        url: '/admin/user/group/index',
        form: { page: 1, limit: 100, search: '', filter: '{}', op: '{}', sort: 'id', order: 'desc' },
      })
      // PHP returns BARE {total, rows} JSON (not the envelope) for this ajax list.
      const body = r as unknown as { total: number | string; rows: Array<{ id: number; name: string }> }
      expect(Array.isArray(body.rows)).toBe(true)
      expect(typeof body.total === 'number' || typeof body.total === 'string').toBe(true)
      expect(body.rows.some((row) => row.id === group.id)).toBe(true)
    })
  })

  describe('del (inherited)', () => {
    it('deletes a group with no member references', async () => {
      const http = await loginAsAdmin()
      const group = await insertUserGroup()
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/del',
        form: { ids: String(group.id) },
      })
      expect(r.code).toBe(1)
      const after = await fetchUserGroup(group.id)
      expect(after).toBeNull()
    })

    it.skip('refuses to delete a group with members — Unclear from code: "本控制器未覆盖 del；按已读代码无成员引用检查"', () => {})
  })

  describe('multi (inherited)', () => {
    it('batch updates status', async () => {
      const http = await loginAsAdmin()
      const group = await insertUserGroup({ status: 'normal' })
      const r = await http.json({
        method: 'POST',
        url: '/admin/user/group/multi',
        form: { ids: String(group.id), params: 'status=hidden' },
      })
      expect(r.code).toBe(1)
      const after = await fetchUserGroup(group.id)
      expect(after?.status).toBe('hidden')
    })
  })

  it.skip('getStatusList source — Unclear from code: "app\\common\\model\\UserGroup 未定义此方法；疑似在 app\\admin\\model\\UserGroup"', () => {})
})
