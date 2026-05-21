// admin/Category — black-box integration tests.
// Spec: task/specs/admin-Category.md
// Inherits Backend CRUD: del / multi / recyclebin / destroy / restore (per _inherit-backend.md).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loginAsAdmin } from '../helpers/auth.ts'
import { closeFixtureConnection, cleanupTracked, makeCategory } from '../helpers/fixtures.ts'
import type { HttpClient, Envelope } from '../helpers/http.ts'
import { withApp } from '../../scripts/db.ts'

interface AjaxList { total: number; rows: Array<Record<string, unknown>> }
interface SelectpageResult { list: Array<Record<string, unknown>>; total: number }

let http: HttpClient

beforeEach(async () => {
  http = await loginAsAdmin('super')
})

afterEach(async () => {
  await cleanupTracked()
})

afterAll(async () => {
  await closeFixtureConnection()
})

describe('admin/Category', () => {
  describe('index', () => {
    it('GET renders the list page HTML', async () => {
      const html = await http.html({ method: 'GET', url: '/admin/category/index' })
      expect(html.length).toBeGreaterThan(0)
      // common admin layout marker
      expect(html.toLowerCase()).toContain('<!doctype html')
    })

    it('Ajax returns bare {total, rows} envelope with tree-indented names', async () => {
      const parent = await makeCategory({ name: `t_parent_${Date.now().toString(36)}` })
      const child = await makeCategory({ pid: parent.id, name: `t_child_${Date.now().toString(36)}` })

      const res = await http.request<AjaxList>({
        method: 'GET',
        url: '/admin/category/index',
        ajax: true,
      })
      expect(res.status).toBe(200)
      expect(typeof res.body).toBe('object')
      const body = res.body as unknown as AjaxList
      // Spec: top-level {total, rows} — NOT the {code,msg,data} envelope.
      expect(body).toHaveProperty('total')
      expect(body).toHaveProperty('rows')
      expect(typeof body.total).toBe('number')
      expect(Array.isArray(body.rows)).toBe(true)
      expect(body.total).toBe(body.rows.length)

      const parentRow = body.rows.find((r) => r.id === parent.id)
      const childRow = body.rows.find((r) => r.id === child.id)
      expect(parentRow).toBeDefined()
      expect(childRow).toBeDefined()
      // Tree::getTreeList prepends &nbsp; + box-drawing chars before child names.
      expect(String(childRow!.name)).toContain('&nbsp;')
      // parent.haschild flag should be set (child exists under it)
      expect(Number(parentRow!.haschild)).toBe(1)
    })

    it('Ajax filters by exact type when type != "all"', async () => {
      const otherType = `t_type_${Date.now().toString(36)}`
      const wanted = await makeCategory({ type: otherType })
      const ignored = await makeCategory({ type: 'default' })

      const res = await http.request<AjaxList>({
        method: 'GET',
        url: '/admin/category/index',
        query: { type: otherType },
        ajax: true,
      })
      const body = res.body as unknown as AjaxList
      const ids = body.rows.map((r) => r.id)
      expect(ids).toContain(wanted.id)
      expect(ids).not.toContain(ignored.id)
    })

    it('unauthenticated request is rejected', async () => {
      const { createHttpClient } = await import('../helpers/http.ts')
      const anon = createHttpClient()
      const r = await anon.request({ method: 'GET', url: '/admin/category/index', ajax: true })
      // Either a redirect (302) or a JSON error envelope from parent _initialize.
      expect(r.status === 302 || (typeof r.body === 'object' && (r.body as unknown as Envelope).code !== 1)).toBe(true)
    })
  })

  describe('add', () => {
    it('GET renders the add form with __token__', async () => {
      const token = await http.fetchToken('/admin/category/add')
      expect(token).toMatch(/^[a-f0-9]{20,}$/)
    })

    it('POST creates a category and writes fa_category', async () => {
      const token = await http.fetchToken('/admin/category/add')
      const name = `t_new_${Date.now().toString(36)}`
      const res = await http.json<unknown>({
        method: 'POST',
        url: '/admin/category/add',
        form: {
          'row[type]': 'default',
          'row[pid]': 0,
          'row[name]': name,
          'row[nickname]': `Nick ${name}`,
          'row[status]': 'normal',
          'row[flag]': '',
          'row[weigh]': 0,                 // required: model's afterInsert hook reads $row['weigh']
          'row[image]': '',
          'row[keywords]': '',
          'row[description]': '',
          'row[diyname]': '',
          __token__: token,
        },
      })
      expect(res.code).toBe(1)
      const created = await withApp(async (db) => {
        const [rows] = await db.query<any[]>(
          'SELECT id, pid, type, name, nickname, weigh FROM fa_category WHERE name = ?',
          [name],
        )
        return rows[0]
      })
      expect(created).toBeDefined()
      expect(created.pid).toBe(0)
      expect(created.type).toBe('default')
      // afterInsert: when weigh was 0/empty at insert, model writes id into weigh.
      expect(Number(created.weigh)).toBe(Number(created.id))
      // track so cleanup wipes it
      const { trackForCleanup } = await import('../helpers/fixtures.ts')
      trackForCleanup('fa_category', created.id)
    })

    it('POST without __token__ fails with Token verification error', async () => {
      const res = await http.json<unknown>({
        method: 'POST',
        url: '/admin/category/add',
        form: {
          'row[type]': 'default',
          'row[pid]': 0,
          'row[name]': `t_notoken_${Date.now().toString(36)}`,
        },
      })
      expect(res.code).toBe(0)
      expect(res.msg.length).toBeGreaterThan(0)
    })
  })

  describe('edit', () => {
    it('GET renders the edit form for an existing id', async () => {
      const cat = await makeCategory()
      const html = await http.html({ method: 'GET', url: `/admin/category/edit/ids/${cat.id}` })
      expect(html.length).toBeGreaterThan(0)
      expect(html).toContain(cat.name)
    })

    it('POST updates a category', async () => {
      const cat = await makeCategory()
      const token = await http.fetchToken(`/admin/category/edit/ids/${cat.id}`)
      const newNick = `Updated ${Date.now().toString(36)}`
      const res = await http.json<unknown>({
        method: 'POST',
        url: '/admin/category/edit',
        form: {
          ids: cat.id,
          'row[type]': cat.type,
          'row[pid]': cat.pid,
          'row[name]': cat.name,
          'row[nickname]': newNick,
          'row[status]': cat.status,
          'row[flag]': '',
          __token__: token,
        },
      })
      expect(res.code).toBe(1)
      const after = await withApp(async (db) => {
        const [rows] = await db.query<any[]>('SELECT nickname FROM fa_category WHERE id = ?', [cat.id])
        return rows[0]
      })
      expect(after.nickname).toBe(newNick)
    })

    it('POST refuses to set pid to itself / descendant', async () => {
      const parent = await makeCategory()
      const child = await makeCategory({ pid: parent.id })
      const token = await http.fetchToken(`/admin/category/edit/ids/${parent.id}`)
      const res = await http.json<unknown>({
        method: 'POST',
        url: '/admin/category/edit',
        form: {
          ids: parent.id,
          'row[type]': parent.type,
          'row[pid]': child.id, // making parent a child of its own descendant
          'row[name]': parent.name,
          'row[nickname]': parent.nickname,
          'row[status]': parent.status,
          'row[flag]': '',
          __token__: token,
        },
      })
      expect(res.code).toBe(0)
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it('GET with non-existent id errors with "No Results were found"', async () => {
      const res = await http.request<unknown>({
        method: 'GET',
        url: '/admin/category/edit/ids/99999999',
        ajax: true,
      })
      if (typeof res.body === 'object') {
        expect((res.body as unknown as Envelope).code).toBe(0)
        expect((res.body as unknown as Envelope).msg.length).toBeGreaterThan(0)
      } else {
        // Some installs render an HTML error page; accept as long as it's not blank.
        expect(res.body.length).toBeGreaterThan(0)
      }
    })
  })

  describe('selectpage', () => {
    it('returns {list, total} top-level structure', async () => {
      const cat = await makeCategory()
      const res = await http.request<SelectpageResult>({
        method: 'GET',
        url: '/admin/category/selectpage',
        query: { showField: 'name', keyField: 'id', pageNumber: 1, pageSize: 50 },
        ajax: true,
      })
      expect(res.status).toBe(200)
      const body = res.body as unknown as SelectpageResult
      expect(body).toHaveProperty('list')
      expect(body).toHaveProperty('total')
      expect(Array.isArray(body.list)).toBe(true)
      expect(typeof body.total).toBe('number')
      const hit = body.list.find((r) => Number(r.id) === cat.id)
      expect(hit).toBeDefined()
      expect(hit).toHaveProperty('pid')
    })

    it('keyword search via q_word narrows results', async () => {
      const tag = `qword_${Date.now().toString(36)}`
      const wanted = await makeCategory({ name: tag })
      const res = await http.request<SelectpageResult>({
        method: 'GET',
        url: '/admin/category/selectpage',
        query: {
          showField: 'name',
          keyField: 'id',
          'q_word[]': tag,
          'searchField[]': 'name',
          pageNumber: 1,
          pageSize: 50,
        },
        ajax: true,
      })
      const body = res.body as unknown as SelectpageResult
      expect(body.list.some((r) => Number(r.id) === wanted.id)).toBe(true)
    })
  })

  // ----- inherited Backend CRUD -----

  describe('del', () => {
    it('POST /del with comma-joined ids deletes (or soft-deletes) rows', async () => {
      const a = await makeCategory()
      const b = await makeCategory()
      const res = await http.json<unknown>({
        method: 'POST',
        url: '/admin/category/del',
        form: { ids: `${a.id},${b.id}` },
      })
      expect(res.code).toBe(1)
      // Category model has NO SoftDelete trait → physical delete expected.
      const remaining = await withApp(async (db) => {
        const [rows] = await db.query<any[]>(
          'SELECT id FROM fa_category WHERE id IN (?, ?)',
          [a.id, b.id],
        )
        return rows
      })
      expect(remaining.length).toBe(0)
    })
  })

  describe('multi', () => {
    it('POST /multi updates a field on many rows at once', async () => {
      const a = await makeCategory({ status: 'normal' })
      const b = await makeCategory({ status: 'normal' })
      const res = await http.json<unknown>({
        method: 'POST',
        url: '/admin/category/multi',
        form: { ids: `${a.id},${b.id}`, params: 'status=hidden' },
      })
      expect(res.code).toBe(1)
      const rows = await withApp(async (db) => {
        const [r] = await db.query<any[]>(
          'SELECT id, status FROM fa_category WHERE id IN (?, ?)',
          [a.id, b.id],
        )
        return r
      })
      expect(rows.every((r) => r.status === 'hidden')).toBe(true)
    })
  })

  // The Category model has NO SoftDelete trait, so the inherited recyclebin /
  // destroy / restore actions cannot function — they query `deletetime IS NOT NULL`
  // on a column that may not exist (spec: "Unclear from code: 未确认表结构").
  // Quote: "Category 模型未启用 SoftDelete trait，所以软删除/回收站逻辑实际不可用"

  describe('recyclebin', () => {
    it.skip('soft-deleted rows appear in recyclebin — Unclear from code: "Category 模型未启用 SoftDelete trait"', () => {
      // see spec: 软删除/回收站逻辑实际不可用
    })
  })

  describe('destroy', () => {
    it.skip('POST /destroy physically removes recyclebin rows — Unclear from code: "SoftDelete trait" missing on Category model', () => {
      // see spec: destroy 依赖 SoftDelete
    })
  })

  describe('restore', () => {
    it.skip('POST /restore brings rows back from recyclebin — Unclear from code: "Category 模型未启用 SoftDelete trait"', () => {
      // see spec: restore 依赖 SoftDelete
    })
  })
})
