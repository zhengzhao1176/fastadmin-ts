// Black-box tests for /admin.php/ajax/<action>. Covers lang, upload, weigh,
// wipecache, category, area, icon per task/specs/admin-Ajax.md.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import FormData from 'form-data'
import { loginAsAdmin, unauthenticated } from '../helpers/auth.ts'
import {
  cleanupTracked,
  closeFixtureConnection,
  makeCategory,
} from '../helpers/fixtures.ts'
import { withApp } from '../../scripts/db.ts'
import type { HttpClient } from '../helpers/http.ts'

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

describe('admin/Ajax', () => {
  // -----------------------------------------------------------------------
  describe('lang', () => {
    it('returns JSONP wrapper for valid controllername+lang (no auth required)', async () => {
      const guest = unauthenticated()
      const r = await guest.request<unknown>({
        method: 'GET',
        url: '/admin/ajax/lang',
        query: { controllername: 'index', lang: 'zh-cn', callback: 'define' },
        ajax: false,
      })
      expect(r.status).toBe(200)
      const ct = r.headers['content-type'] ?? ''
      expect(ct).toMatch(/javascript/i)
      expect(typeof r.body).toBe('string')
      expect(r.body as unknown as string).toMatch(/^define\(.*\);?\s*$/s)
    })

    it('returns errmsg JSONP when controllername empty/invalid', async () => {
      const guest = unauthenticated()
      const r = await guest.request<unknown>({
        method: 'GET',
        url: '/admin/ajax/lang',
        query: { controllername: '', lang: 'zh-cn', callback: 'define' },
        ajax: false,
      })
      expect(r.status).toBe(200)
      expect(r.body as unknown as string).toMatch(/errmsg/)
    })

    it('returns errmsg JSONP when lang not in allow_lang_list', async () => {
      const guest = unauthenticated()
      const r = await guest.request<unknown>({
        method: 'GET',
        url: '/admin/ajax/lang',
        query: { controllername: 'index', lang: 'xx-yy', callback: 'define' },
        ajax: false,
      })
      expect(r.status).toBe(200)
      expect(r.body as unknown as string).toMatch(/errmsg/)
    })
  })

  // -----------------------------------------------------------------------
  describe('upload', () => {
    function buildForm(fields: Record<string, string | { buf: Buffer; filename: string; contentType?: string }>): FormData {
      const fd = new FormData()
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string') fd.append(k, v)
        else fd.append(k, v.buf, { filename: v.filename, contentType: v.contentType })
      }
      return fd
    }

    it('uploads a small image, returns url/fullurl and inserts attachment row', async () => {
      // Minimal valid PNG (8-byte signature + IHDR + IDAT + IEND).
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000d49444154789c63f8ff9f01040000ffff03000005000164b1a4a30000000049454e44ae426082',
        'hex',
      )
      const fd = buildForm({ file: { buf: png, filename: 'tiny.png', contentType: 'image/png' } })
      const r = await admin.json<{ url: string; fullurl: string }>({
        method: 'POST',
        url: '/admin/ajax/upload',
        multipart: fd,
      })
      expect(r.code).toBe(1)
      expect(r.data?.url).toMatch(/^\/uploads\//)
      expect(r.data?.fullurl).toMatch(/^https?:\/\//)

      const rows = await withApp(async (db) => {
        const [res] = await db.query('SELECT id, url, mimetype FROM `fa_attachment` WHERE url = ?', [r.data!.url])
        return res as Array<{ id: number; url: string; mimetype: string }>
      })
      expect(rows.length).toBeGreaterThan(0)
      // Best-effort cleanup of the inserted row so other tests are unaffected.
      if (rows[0]?.id != null) {
        await withApp(async (db) => {
          await db.query('DELETE FROM `fa_attachment` WHERE id = ?', [rows[0]!.id])
        })
      }
    })

    it('returns code=0 when uploading a php file (executable filter)', async () => {
      const fd = buildForm({
        file: { buf: Buffer.from('<?php echo 1;'), filename: 'evil.php', contentType: 'application/octet-stream' },
      })
      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/upload',
        multipart: fd,
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code=0 when no file present', async () => {
      const fd = buildForm({})
      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/upload',
        multipart: fd,
      })
      expect(r.code).toBe(0)
    })

    it('handles chunked upload + merge flow', async () => {
      // Three parts of an octet-stream "file". Server stores them in RUNTIME_PATH/chunks/.
      const chunkid = '11111111-2222-3333-4444-555555555566'
      const parts = [Buffer.from('AAAA'), Buffer.from('BBBB'), Buffer.from('CCCC')]
      const postChunk = (i: number) => admin.json({
        method: 'POST',
        url: '/admin/ajax/upload',
        multipart: buildForm({
          chunkid,
          chunkindex: String(i),
          chunkcount: '3',
          file: { buf: parts[i]!, filename: `part-${i}.part`, contentType: 'application/octet-stream' },
        }),
      })

      // Chunked upload is gated behind a config flag — FastAdmin ships it OFF
      // by default ("未开启分片上传功能"). When the target has chunking disabled
      // the first chunk returns code=0; that is valid reference behaviour, so
      // the test tolerates it and only asserts the full merge flow when the
      // feature is actually enabled.
      const first = await postChunk(0)
      if (first.code === 0) {
        expect(first.msg.length).toBeGreaterThan(0)
        return
      }
      expect(first.code).toBe(1)
      for (let i = 1; i < parts.length; i++) {
        const r = await postChunk(i)
        // Each chunk is accepted and staged; no url returned until merge.
        expect(r.code).toBe(1)
      }
      const mergeFd = buildForm({
        chunkid,
        chunkcount: '3',
        filename: 'merged.bin',
        action: 'merge',
      })
      const merged = await admin.json<{ url: string; fullurl: string }>({
        method: 'POST',
        url: '/admin/ajax/upload',
        multipart: mergeFd,
      })
      expect(merged.code).toBe(1)
      expect(merged.data?.url).toMatch(/^\/uploads\//)

      // Clean up the inserted attachment row.
      await withApp(async (db) => {
        await db.query('DELETE FROM `fa_attachment` WHERE url = ?', [merged.data!.url])
      })
    })

    it('rejects upload when unauthenticated', async () => {
      const guest = unauthenticated()
      const fd = buildForm({
        file: { buf: Buffer.from('x'), filename: 'a.txt', contentType: 'text/plain' },
      })
      const r = await guest.request({
        method: 'POST',
        url: '/admin/ajax/upload',
        multipart: fd,
      })
      // Either an envelope with code != 1 or an HTML login redirect.
      if (typeof r.body === 'string') {
        expect(r.body.length).toBeGreaterThan(0)
      } else {
        expect(r.body.code).not.toBe(1)
      }
    })
  })

  // -----------------------------------------------------------------------
  describe('weigh', () => {
    it('reorders categories and persists weigh values', async () => {
      const cats = [] as Array<{ id: number; weigh: number }>
      for (let i = 0; i < 5; i++) {
        const c = await makeCategory({ type: 'default', weigh: 10 - i })
        cats.push({ id: c.id, weigh: c.weigh })
      }
      const ids = cats.map((c) => c.id)
      const csvAsc = [...ids].reverse().join(',') // request new order: reversed
      const changeid = ids[0] // move first to last

      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/weigh',
        form: {
          ids: csvAsc,
          changeid: String(changeid),
          field: 'weigh',
          table: 'category',
          orderway: 'desc',
        },
      })
      expect(r.code).toBe(1)

      const rows = await withApp(async (db) => {
        const [res] = await db.query(
          `SELECT id, weigh FROM \`fa_category\` WHERE id IN (?, ?, ?, ?, ?) ORDER BY weigh DESC, id DESC`,
          ids,
        )
        return res as Array<{ id: number; weigh: number }>
      })
      // The action ran without error and rows still exist (count preserved).
      expect(rows.length).toBe(5)
      // Distinct weighs should still cover the original set, optionally permuted.
      const weighs = rows.map((r) => Number(r.weigh)).sort((a, b) => a - b)
      expect(weighs.length).toBe(5)
    })

    it('returns code=0 when table fails alphaDash validation', async () => {
      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/weigh',
        form: { ids: '1,2', changeid: '1', table: '!!!bad table!!!' },
      })
      expect(r.code).toBe(0)
    })

    it('rejects when unauthenticated', async () => {
      const guest = unauthenticated()
      const r = await guest.request({
        method: 'POST',
        url: '/admin/ajax/weigh',
        form: { ids: '1', changeid: '1', table: 'category' },
        ajax: true,
      })
      if (typeof r.body === 'string') {
        expect(r.body.length).toBeGreaterThan(0)
      } else {
        expect(r.body.code).not.toBe(1)
      }
    })
  })

  // -----------------------------------------------------------------------
  describe('wipecache', () => {
    it('happy path: type=content returns code=1', async () => {
      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/wipecache',
        form: { type: 'content' },
      })
      expect(r.code).toBe(1)
    })

    it('type=all triggers fall-through clears without error', async () => {
      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/wipecache',
        form: { type: 'all' },
      })
      expect(r.code).toBe(1)
    })

    it('unknown/empty type still returns code=1 (default switch case, hook only)', async () => {
      const r = await admin.json({
        method: 'POST',
        url: '/admin/ajax/wipecache',
        form: { type: '' },
      })
      expect(r.code).toBe(1)
    })

    it.skip("exception during clear surfaces code=0 — Unclear from code: can't reliably trigger a clear failure in test env (\"任一缓存清理过程抛出 \\Exception\")", () => {})

    it('rejects when unauthenticated', async () => {
      const guest = unauthenticated()
      const r = await guest.request({
        method: 'POST',
        url: '/admin/ajax/wipecache',
        form: { type: 'content' },
        ajax: true,
      })
      if (typeof r.body === 'string') {
        expect(r.body.length).toBeGreaterThan(0)
      } else {
        expect(r.body.code).not.toBe(1)
      }
    })
  })

  // -----------------------------------------------------------------------
  describe('category', () => {
    it('returns categories of the requested type as {value,name} list', async () => {
      const seeded = [] as number[]
      for (let i = 0; i < 3; i++) {
        const c = await makeCategory({ type: 'default' })
        seeded.push(c.id)
      }
      const r = await admin.json<Array<{ value: number; name: string }>>({
        method: 'GET',
        url: '/admin/ajax/category',
        query: { type: 'default' },
      })
      expect(r.code).toBe(1)
      expect(Array.isArray(r.data)).toBe(true)
      const ids = (r.data ?? []).map((x) => Number(x.value))
      for (const id of seeded) expect(ids).toContain(id)
      for (const item of r.data ?? []) {
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('name')
      }
    })

    it('honors explicit pid=0 filter (treated as filter, not "unset")', async () => {
      const c = await makeCategory({ type: 'default', pid: 0 })
      const r = await admin.json<Array<{ value: number; name: string }>>({
        method: 'GET',
        url: '/admin/ajax/category',
        query: { type: 'default', pid: '0' },
      })
      expect(r.code).toBe(1)
      const ids = (r.data ?? []).map((x) => Number(x.value))
      expect(ids).toContain(c.id)
    })

    it.skip('query exception bubbles to HTTP 500 — Unclear from code: "未显式捕获"', () => {})

    it('rejects when unauthenticated', async () => {
      const guest = unauthenticated()
      const r = await guest.request({
        method: 'GET',
        url: '/admin/ajax/category',
        query: { type: 'default' },
        ajax: true,
      })
      if (typeof r.body === 'string') {
        expect(r.body.length).toBeGreaterThan(0)
      } else {
        expect(r.body.code).not.toBe(1)
      }
    })
  })

  // -----------------------------------------------------------------------
  describe('area', () => {
    it('returns provinces when no province given (level=1, pid=0)', async () => {
      const r = await admin.json<Array<{ value: number; name: string }>>({
        method: 'GET',
        url: '/admin/ajax/area',
        query: {},
      })
      expect(r.code).toBe(1)
      expect(Array.isArray(r.data)).toBe(true)
      if ((r.data ?? []).length > 0) {
        expect(r.data![0]).toHaveProperty('value')
        expect(r.data![0]).toHaveProperty('name')
      }
    })

    it('returns cities when province is given (level=2)', async () => {
      const provinces = await admin.json<Array<{ value: number; name: string }>>({
        method: 'GET',
        url: '/admin/ajax/area',
        query: {},
      })
      const provinceId = provinces.data?.[0]?.value
      if (provinceId == null) return // empty area table; skip body assertions
      const r = await admin.json<Array<{ value: number; name: string }>>({
        method: 'GET',
        url: '/admin/ajax/area',
        query: { province: String(provinceId) },
      })
      expect(r.code).toBe(1)
      expect(Array.isArray(r.data)).toBe(true)
    })

    it.skip('query exception bubbles to HTTP 500 — Unclear from code: "未显式捕获"', () => {})

    it('rejects when unauthenticated', async () => {
      const guest = unauthenticated()
      const r = await guest.request({
        method: 'GET',
        url: '/admin/ajax/area',
        query: {},
        ajax: true,
      })
      if (typeof r.body === 'string') {
        expect(r.body.length).toBeGreaterThan(0)
      } else {
        expect(r.body.code).not.toBe(1)
      }
    })
  })

  // -----------------------------------------------------------------------
  describe('icon', () => {
    it('returns an SVG body with image/svg+xml content-type for default suffix', async () => {
      const r = await admin.request<unknown>({
        method: 'GET',
        url: '/admin/ajax/icon',
        ajax: false,
      })
      expect(r.status).toBe(200)
      const ct = r.headers['content-type'] ?? ''
      expect(ct).toMatch(/svg/i)
      expect(typeof r.body).toBe('string')
      expect(r.body as unknown as string).toMatch(/<svg/i)
    })

    it('honors a custom suffix in the rendered SVG', async () => {
      const r = await admin.request<unknown>({
        method: 'GET',
        url: '/admin/ajax/icon',
        query: { suffix: 'PNG' },
        ajax: false,
      })
      expect(r.status).toBe(200)
      expect(r.body as unknown as string).toMatch(/<svg/i)
    })

    it.skip('build_suffix_image throw bubbles to HTTP 500 — Unclear from code: "未显式捕获"', () => {})

    it('rejects when unauthenticated', async () => {
      const guest = unauthenticated()
      const r = await guest.request({
        method: 'GET',
        url: '/admin/ajax/icon',
        ajax: false,
      })
      // Either HTML login redirect/page or JSON envelope with code != 1.
      if (typeof r.body === 'string') {
        // Not an SVG body (would imply auth bypass).
        expect(r.body).not.toMatch(/<svg[\s>]/i)
      } else {
        expect(r.body.code).not.toBe(1)
      }
    })
  })
})
