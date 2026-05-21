// Black-box tests for admin/auth/Adminlog controller.
// Spec: task/specs/admin-auth-Adminlog.md
//
// AdminLog is a read-only controller backed by `fa_admin_log`. The table is
// populated by a global admin behaviour that calls AdminLog::record() after
// each admin write action — `index` and `selectpage` are filtered out of that
// recorder via $ignoreRegex. Therefore the side-effect tests trigger a write
// (category/add) and then assert a fresh row landed in fa_admin_log.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loginAsAdmin } from '../../helpers/auth.ts'
import { makeCategory, cleanupTracked, closeFixtureConnection } from '../../helpers/fixtures.ts'
import { withApp } from '../../../scripts/db.ts'
import type { Envelope, HttpClient } from '../../helpers/http.ts'
import type { RowDataPacket } from 'mysql2'

interface AdminLogRow extends RowDataPacket {
  id: number
  admin_id: number
  username: string
  url: string
  title: string
  content: string
  useragent: string
  ip: string
  createtime: number
}

interface IndexResult { total: number; rows: Array<{ id: number; url: string; title: string; username: string }> }

/** Trigger a write action so the behaviour records a log row. Returns the latest
 * log row id after the action. */
async function triggerWriteAndGetLatestLogId(http: HttpClient): Promise<number> {
  const sfx = Math.random().toString(36).slice(2, 8)
  const token = await http.fetchToken('/admin/category/add')
  const r = await http.json<unknown>({
    method: 'POST',
    url: '/admin/category/add',
    form: {
      'row[pid]': 0,
      'row[type]': 'default',
      'row[name]': `log_t_${sfx}`,
      'row[nickname]': `LogT ${sfx}`,
      'row[flag]': '',
      'row[image]': '',
      'row[keywords]': '',
      'row[description]': '',
      'row[diyname]': '',
      'row[weigh]': 0,
      'row[status]': 'normal',
      __token__: token,
    },
  })
  expect(r.code).toBe(1)
  // capture the just-created category for cleanup
  const cat = await withApp(async (db) => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM fa_category WHERE name = ? ORDER BY id DESC LIMIT 1`,
      [`log_t_${sfx}`],
    )
    return rows[0]
  })
  if (cat?.id) {
    // Clean the category we just made; cleanupTracked won't know about it.
    await withApp((db) => db.query(`DELETE FROM fa_category WHERE id = ?`, [cat.id]))
  }
  const latest = await withApp(async (db) => {
    const [rows] = await db.query<AdminLogRow[]>(
      `SELECT id, url, title, username FROM fa_admin_log ORDER BY id DESC LIMIT 1`,
    )
    return rows[0]
  })
  expect(latest).toBeDefined()
  return latest!.id
}

describe('admin/auth/Adminlog', () => {
  let admin: HttpClient

  beforeAll(async () => {
    admin = await loginAsAdmin('super')
  })

  afterEach(async () => {
    await cleanupTracked()
  })

  afterAll(async () => {
    await closeFixtureConnection()
  })

  describe('index', () => {
    it('triggering a write action adds a row to fa_admin_log; index returns it', async () => {
      const before = await withApp(async (db) => {
        const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM fa_admin_log`)
        return Number((rows[0] as { c: number }).c)
      })
      await triggerWriteAndGetLatestLogId(admin)
      const after = await withApp(async (db) => {
        const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM fa_admin_log`)
        return Number((rows[0] as { c: number }).c)
      })
      expect(after).toBeGreaterThan(before)

      const r = await admin.json<IndexResult>({
        method: 'GET',
        url: '/admin/auth/adminlog/index',
        query: { limit: 5, sort: 'id', order: 'desc' },
      })
      // index returns raw {total, rows} — NOT the admin envelope.
      const body = r as unknown as IndexResult
      expect(typeof body.total).toBe('number')
      expect(Array.isArray(body.rows)).toBe(true)
      expect(body.total).toBeGreaterThan(0)
      // list excludes content/useragent (large fields)
      const first = body.rows[0]!
      expect(first).toBeDefined()
      expect((first as Record<string, unknown>).content).toBeUndefined()
      expect((first as Record<string, unknown>).useragent).toBeUndefined()
    })

    it('GET (HTML) returns 200', async () => {
      const html = await admin.html({ method: 'GET', url: '/admin/auth/adminlog/index' })
      expect(html.length).toBeGreaterThan(0)
    })

    it('filter by username narrows results', async () => {
      await triggerWriteAndGetLatestLogId(admin)
      const r = await admin.json<IndexResult>({
        method: 'GET',
        url: '/admin/auth/adminlog/index',
        query: {
          filter: JSON.stringify({ username: 'admin' }),
          op: JSON.stringify({ username: '=' }),
          limit: 50,
        },
      })
      const body = r as unknown as IndexResult
      expect(body.rows.every((row) => row.username === 'admin')).toBe(true)
    })

    it('filter by url LIKE narrows results', async () => {
      await triggerWriteAndGetLatestLogId(admin)
      const r = await admin.json<IndexResult>({
        method: 'GET',
        url: '/admin/auth/adminlog/index',
        query: {
          filter: JSON.stringify({ url: 'category' }),
          op: JSON.stringify({ url: 'LIKE' }),
          limit: 50,
        },
      })
      const body = r as unknown as IndexResult
      expect(body.rows.length).toBeGreaterThan(0)
      expect(body.rows.every((row) => row.url.toLowerCase().includes('category'))).toBe(true)
    })

    it('search by id locates the freshly-written row', async () => {
      const newId = await triggerWriteAndGetLatestLogId(admin)
      const r = await admin.json<IndexResult>({
        method: 'GET',
        url: '/admin/auth/adminlog/index',
        query: { search: String(newId), limit: 10 },
      })
      const body = r as unknown as IndexResult
      expect(body.rows.some((row) => row.id === newId)).toBe(true)
    })
  })

  describe('detail', () => {
    it('returns HTML for an existing log id (within admin scope)', async () => {
      const id = await triggerWriteAndGetLatestLogId(admin)
      const html = await admin.html({
        method: 'GET',
        url: `/admin/auth/adminlog/detail/ids/${id}`,
      })
      expect(html.length).toBeGreaterThan(0)
    })

    it('returns error envelope when ids does not exist', async () => {
      const r = await admin.json<unknown>({
        method: 'GET',
        url: '/admin/auth/adminlog/detail/ids/999999999',
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
      expect(env.msg.length).toBeGreaterThan(0)
    })

    it.skip("Unclear from code: 详情模板字段（未读取 auth/adminlog/detail.html，spec: '具体字段呈现由 auth/adminlog/detail.html 决定，Unclear from code: 未读取模板'）", () => {
      // intentionally skipped per spec
    })
  })

  describe('add', () => {
    it('always returns error envelope (read-only controller)', async () => {
      const r = await admin.json<unknown>({
        method: 'GET',
        url: '/admin/auth/adminlog/add',
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })

    it('POST also returns error envelope', async () => {
      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/add',
        form: { anything: 'goes' },
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })
  })

  describe('edit', () => {
    it('always returns error envelope (read-only controller)', async () => {
      const r = await admin.json<unknown>({
        method: 'GET',
        url: '/admin/auth/adminlog/edit/ids/1',
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })

    it('POST with form data also returns error envelope', async () => {
      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/edit',
        form: { ids: 1, 'row[title]': 'whatever' },
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })
  })

  describe('del', () => {
    it('non-POST returns Invalid parameters error', async () => {
      const r = await admin.json<unknown>({
        method: 'GET',
        url: '/admin/auth/adminlog/del/ids/1',
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
      expect(env.msg.length).toBeGreaterThan(0)
    })

    it('POST without ids returns error', async () => {
      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/del',
        form: {},
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })

    it('POST with non-matching ids returns error', async () => {
      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/del',
        form: { ids: '999999999' },
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })

    it('POST with valid ids physically deletes rows from fa_admin_log', async () => {
      const id = await triggerWriteAndGetLatestLogId(admin)

      const presentBefore = await withApp(async (db) => {
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT id FROM fa_admin_log WHERE id = ?`, [id],
        )
        return rows.length
      })
      expect(presentBefore).toBe(1)

      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/del',
        form: { ids: String(id) },
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(1)

      const presentAfter = await withApp(async (db) => {
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT id FROM fa_admin_log WHERE id = ?`, [id],
        )
        return rows.length
      })
      expect(presentAfter).toBe(0)
    })

    it('POST with batch ids deletes all matching rows', async () => {
      // also makes use of fixture builder so a tracked write is associated
      await makeCategory()
      const id1 = await triggerWriteAndGetLatestLogId(admin)
      const id2 = await triggerWriteAndGetLatestLogId(admin)
      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/del',
        form: { ids: `${id1},${id2}` },
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(1)

      const remaining = await withApp(async (db) => {
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT id FROM fa_admin_log WHERE id IN (?, ?)`, [id1, id2],
        )
        return rows.length
      })
      expect(remaining).toBe(0)
    })
  })

  describe('multi', () => {
    it('always returns error envelope (read-only controller)', async () => {
      const r = await admin.json<unknown>({
        method: 'POST',
        url: '/admin/auth/adminlog/multi',
        form: { ids: '1,2,3', params: 'status:hidden' },
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })

    it('GET also returns error envelope', async () => {
      const r = await admin.json<unknown>({
        method: 'GET',
        url: '/admin/auth/adminlog/multi',
      })
      const env = r as Envelope<unknown>
      expect(env.code).toBe(0)
    })
  })
})
