// Black-box integration tests for admin/general/Attachment controller.
// Source of truth: task/specs/admin-general-Attachment.md
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginAsAdmin, unauthenticated } from '../../helpers/auth.ts'
import {
  cleanupTracked,
  closeFixtureConnection,
  makeAttachment,
} from '../../helpers/fixtures.ts'
import type { HttpClient } from '../../helpers/http.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_TEST_DIR = path.resolve(
  __dirname,
  '../../../fastAdmin/public/uploads/test',
)

interface ListResponse {
  total: number
  rows: Array<Record<string, unknown>>
}

function ensureUploadsTestDir(): void {
  if (!fs.existsSync(UPLOADS_TEST_DIR)) {
    fs.mkdirSync(UPLOADS_TEST_DIR, { recursive: true })
  }
}

function writePhysicalFile(relUrl: string, body = 'test-content'): string {
  // relUrl is like "/uploads/test/<sfx>.txt" — translate to absolute under public/
  const abs = path.resolve(
    __dirname,
    '../../../fastAdmin/public' + relUrl,
  )
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
  return abs
}

let admin: HttpClient

beforeAll(async () => {
  ensureUploadsTestDir()
  admin = await loginAsAdmin('super')
})

afterEach(async () => {
  await cleanupTracked()
})

afterAll(async () => {
  await closeFixtureConnection()
})

describe('admin/general/Attachment', () => {
  // ----------------------- index -----------------------
  describe('index', () => {
    it('returns HTML list page on plain GET', async () => {
      const html = await admin.html({ method: 'GET', url: '/admin/general/attachment/index' })
      expect(html.length).toBeGreaterThan(0)
      expect(html.toLowerCase()).toContain('<')
    })

    it('returns {total, rows} JSON envelope on ajax GET', async () => {
      const a = await makeAttachment({ mimetype: 'image/png', url: `/uploads/test/idx_${Date.now()}.png` })
      const r = await admin.request<ListResponse>({
        method: 'GET',
        url: '/admin/general/attachment/index',
        query: { page: 1, limit: 50, sort: 'id', order: 'desc' },
        ajax: true,
      })
      expect(r.status).toBe(200)
      // Spec: returns {total, rows} top-level (not wrapped in code/data envelope)
      expect(typeof r.body).toBe('object')
      const body = r.body as unknown as ListResponse
      expect(body.total).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(body.rows)).toBe(true)
      const found = body.rows.find((row) => row.id === a.id)
      expect(found).toBeDefined()
      // every row gets a `fullurl` appended
      expect(typeof (found as Record<string, unknown>).fullurl).toBe('string')
    })

    it('search filter narrows rows by filename/url', async () => {
      const marker = `idxsearch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const a = await makeAttachment({ url: `/uploads/test/${marker}.txt` })
      const r = await admin.request<ListResponse>({
        method: 'GET',
        url: '/admin/general/attachment/index',
        query: { search: marker, page: 1, limit: 10 },
        ajax: true,
      })
      const body = r.body as unknown as ListResponse
      expect(body.rows.some((row) => row.id === a.id)).toBe(true)
      // every returned row should somehow match the marker
      for (const row of body.rows) {
        const url = String(row.url ?? '')
        const filename = String(row.filename ?? '')
        expect(url.includes(marker) || filename.includes(marker)).toBe(true)
      }
    })

    it('filter.mimetype with wildcard splits into OR conditions', async () => {
      const a = await makeAttachment({ mimetype: 'image/jpeg', url: `/uploads/test/img_${Date.now()}.jpg` })
      const r = await admin.request<ListResponse>({
        method: 'GET',
        url: '/admin/general/attachment/index',
        query: { filter: JSON.stringify({ mimetype: 'image/*' }), limit: 100 },
        ajax: true,
      })
      const body = r.body as unknown as ListResponse
      const matched = body.rows.find((row) => row.id === a.id)
      expect(matched).toBeDefined()
    })

    it('pagination honours limit', async () => {
      // create three attachments so we know there's at least 3 rows
      await makeAttachment()
      await makeAttachment()
      await makeAttachment()
      const r = await admin.request<ListResponse>({
        method: 'GET',
        url: '/admin/general/attachment/index',
        query: { page: 1, limit: 2 },
        ajax: true,
      })
      const body = r.body as unknown as ListResponse
      expect(body.rows.length).toBeLessThanOrEqual(2)
    })

    it('unauthenticated request is blocked (no 200 JSON success)', async () => {
      const guest = unauthenticated()
      const r = await guest.request({
        method: 'GET',
        url: '/admin/general/attachment/index',
        ajax: true,
      })
      // Either non-200 (redirect/permission) or a JSON envelope with code !== 1 / total absent.
      const body = r.body
      if (typeof body === 'object' && body !== null) {
        const env = body as unknown as Record<string, unknown>
        // Should not look like a normal list payload
        expect(env.code !== 1 || env.total == null).toBe(true)
      }
    })
  })

  // ----------------------- select -----------------------
  describe('select', () => {
    it('returns HTML dialog page on plain GET', async () => {
      const html = await admin.html({ method: 'GET', url: '/admin/general/attachment/select' })
      expect(html.length).toBeGreaterThan(0)
    })

    it('ajax GET returns list shape identical to index', async () => {
      const a = await makeAttachment({ mimetype: 'image/png', url: `/uploads/test/sel_${Date.now()}.png` })
      const r = await admin.request<ListResponse>({
        method: 'GET',
        url: '/admin/general/attachment/select',
        query: { mimetype: 'image/', page: 1, limit: 50 },
        ajax: true,
      })
      expect(r.status).toBe(200)
      const body = r.body as unknown as ListResponse
      expect(typeof body.total).toBe('number')
      expect(Array.isArray(body.rows)).toBe(true)
      expect(body.rows.some((row) => row.id === a.id)).toBe(true)
    })
  })

  // ----------------------- add -----------------------
  describe('add', () => {
    it('GET renders upload UI HTML', async () => {
      const html = await admin.html({ method: 'GET', url: '/admin/general/attachment/add' })
      expect(html.length).toBeGreaterThan(0)
    })

    it('ajax access errors out (not the real upload endpoint)', async () => {
      const r = await admin.json({
        method: 'GET',
        url: '/admin/general/attachment/add',
        ajax: true,
      })
      expect(r.code).toBe(0)
    })
  })

  // ----------------------- del -----------------------
  describe('del', () => {
    it('deletes DB row and physical file for local-storage attachment', async () => {
      const sfx = `del_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const relUrl = `/uploads/test/${sfx}.txt`
      const absPath = writePhysicalFile(relUrl, 'will-be-deleted')
      expect(fs.existsSync(absPath)).toBe(true)

      const a = await makeAttachment({ url: relUrl })

      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/del',
        form: { ids: String(a.id) },
      })
      expect(r.code).toBe(1)
      // upload_delete hook should have removed the file on disk
      expect(fs.existsSync(absPath)).toBe(false)
    })

    it('returns error for non-POST (GET) request', async () => {
      const a = await makeAttachment()
      const r = await admin.json({
        method: 'GET',
        url: '/admin/general/attachment/del',
        query: { ids: String(a.id) },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns error when ids is empty', async () => {
      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/del',
        form: { ids: '' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('deletes multiple ids in one call', async () => {
      const a1 = await makeAttachment()
      const a2 = await makeAttachment()
      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/del',
        form: { ids: `${a1.id},${a2.id}` },
      })
      expect(r.code).toBe(1)
    })
  })

  // ----------------------- classify -----------------------
  describe('classify', () => {
    it('updates category for given ids', async () => {
      const a = await makeAttachment()
      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/classify',
        form: { ids: String(a.id), category: 'unclassed' },
      })
      // 'unclassed' is always a valid implicit category per spec
      expect(r.code).toBe(1)
    })

    it('returns error for non-POST request', async () => {
      const a = await makeAttachment()
      const r = await admin.json({
        method: 'GET',
        url: '/admin/general/attachment/classify',
        query: { ids: String(a.id), category: 'unclassed' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns error when ids is empty', async () => {
      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/classify',
        form: { ids: '', category: 'unclassed' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns "Category not found" when category is invalid', async () => {
      const a = await makeAttachment()
      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/classify',
        form: { ids: String(a.id), category: 'this_category_definitely_does_not_exist' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('accepts empty category string (clears category)', async () => {
      const a = await makeAttachment()
      const r = await admin.json({
        method: 'POST',
        url: '/admin/general/attachment/classify',
        form: { ids: String(a.id), category: '' },
      })
      expect(r.code).toBe(1)
    })

    // Spec: "Unclear from code" — whether `classify` borrowing `edit` node means
    // a separate RBAC entry is needed for `classify`. Without a sub-admin
    // fixture wired to a specific node set, this isn't blackbox-verifiable.
    it.skip('classify borrows general/attachment/edit node — Unclear from code: "RBAC 配置中是否需要为 classify 单独建节点不明"', () => {
      // intentionally skipped per spec ambiguity
    })
  })
})
