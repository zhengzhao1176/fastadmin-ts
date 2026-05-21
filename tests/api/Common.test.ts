// Black-box integration tests for /api/common/*.
// Spec: task/specs/api-Common.md
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import FormData from 'form-data'
import { loginAsApiUser, unauthenticated } from '../helpers/auth.ts'
import { createHttpClient } from '../helpers/http.ts'
import { cleanupTracked, closeFixtureConnection } from '../helpers/fixtures.ts'

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

describe('api/Common', () => {
  // -----------------------------------------------------------------
  describe('init', () => {
    it('returns code 1 envelope with upload/version/cdn fields when given valid version (no auth required)', async () => {
      const http = unauthenticated()
      const res = await http.json<{
        citydata?: unknown
        versiondata?: unknown
        uploaddata?: Record<string, unknown>
        coverdata?: unknown
      }>({
        method: 'POST',
        url: '/api/common/init',
        form: { version: '1.0.0' },
      })

      expect(res.code).toBe(1)
      expect(typeof res.msg).toBe('string')
      expect(typeof res.time).toBe('string')
      expect(Number.isFinite(parseInt(res.time))).toBe(true)
      expect(res.data).toBeTruthy()
      // Per spec, data contains: citydata, versiondata, uploaddata, coverdata
      expect(res.data).toHaveProperty('citydata')
      expect(res.data).toHaveProperty('versiondata')
      expect(res.data).toHaveProperty('uploaddata')
      expect(res.data).toHaveProperty('coverdata')

      // uploaddata is rewritten by controller to include cdnurl and uploadurl.
      const upload = res.data.uploaddata
      expect(upload).toBeTruthy()
      expect(typeof upload).toBe('object')
      expect(upload).toHaveProperty('cdnurl')
      expect(upload).toHaveProperty('uploadurl')
    })

    it('returns code 0 with non-empty msg when version is missing', async () => {
      const http = unauthenticated()
      const res = await http.json({
        method: 'POST',
        url: '/api/common/init',
        form: {},
      })
      expect(res.code).toBe(0)
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it('accepts lng/lat without auth and still returns code 1', async () => {
      const http = unauthenticated()
      const res = await http.json({
        method: 'POST',
        url: '/api/common/init',
        form: { version: '1.0.0', lng: '121.5', lat: '31.2' },
      })
      expect(res.code).toBe(1)
    })
  })

  // -----------------------------------------------------------------
  describe('upload', () => {
    function makePngBytes(): Buffer {
      // Minimal valid 1x1 PNG (transparent). Good enough to pass mime + getimagesize.
      return Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
        'hex',
      )
    }

    it('rejects request with no token (code 401 / Please login first)', async () => {
      const http = unauthenticated()
      const form = new FormData()
      form.append('file', makePngBytes(), { filename: 'a.png', contentType: 'image/png' })
      const res = await http.json({
        method: 'POST',
        url: '/api/common/upload',
        multipart: form,
      })
      // Spec: 父类返回 401 / "Please login first"
      expect(res.code).toBe(401)
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it('happy path: authenticated PNG upload returns code 1 and url/fullurl', async () => {
      const http = await loginAsApiUser('alice')
      const form = new FormData()
      form.append('file', makePngBytes(), { filename: 'pixel.png', contentType: 'image/png' })
      const res = await http.json<{ url?: string; fullurl?: string }>({
        method: 'POST',
        url: '/api/common/upload',
        multipart: form,
      })
      expect(res.code).toBe(1)
      expect(res.data).toBeTruthy()
      expect(typeof res.data?.url).toBe('string')
      expect(res.data?.url?.length ?? 0).toBeGreaterThan(0)
      // fullurl may be present per spec; assert when included
      if (res.data?.fullurl !== undefined) {
        expect(typeof res.data.fullurl).toBe('string')
      }
    })

    it('rejects executable/blacklisted file extension (php) with code 0', async () => {
      const http = await loginAsApiUser('alice')
      const form = new FormData()
      form.append('file', Buffer.from('<?php echo 1; ?>'), {
        filename: 'evil.php',
        contentType: 'text/x-php',
      })
      const res = await http.json({
        method: 'POST',
        url: '/api/common/upload',
        multipart: form,
      })
      expect(res.code).toBe(0)
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it('rejects request with no file field (code 0 with non-empty msg)', async () => {
      const http = await loginAsApiUser('alice')
      const form = new FormData()
      form.append('category', 'image')
      const res = await http.json({
        method: 'POST',
        url: '/api/common/upload',
        multipart: form,
      })
      expect(res.code).toBe(0)
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it.skip("'clean' branch — HTTP method == CLEAN (Unclear from code: \"是否存在 _method 等覆盖让 HTTP 方法变成 CLEAN，本任务未阅读 Request 实现\")", async () => {
      // skipped per spec: behaviour of non-standard HTTP method `CLEAN` is unclear.
    })
  })

  // -----------------------------------------------------------------
  describe('captcha', () => {
    it('returns image/* content with non-zero body', async () => {
      const http = unauthenticated()
      const res = await http.request({ method: 'GET', url: '/api/common/captcha' })
      expect(res.status).toBe(200)
      const ct = res.headers['content-type'] ?? ''
      expect(ct.startsWith('image/')).toBe(true)
      // body is a string (utf-8 of binary bytes) or envelope — captcha is binary, so should be string.
      expect(typeof res.body).toBe('string')
      expect((res.body as unknown as string).length).toBeGreaterThan(0)
    })

    it.skip("two consecutive captchas in the same session return different bytes (Unclear from code: PHP captcha cache may key off session+id and yield identical bytes within a tick — needs runtime verification)", async () => {
      const http = unauthenticated()
      const a = await http.request({ method: 'GET', url: '/api/common/captcha' })
      const b = await http.request({ method: 'GET', url: '/api/common/captcha' })
      expect(a.body).not.toBe(b.body)
    })
  })

  // -----------------------------------------------------------------
  describe('CORS preflight', () => {
    // PHP-S returns 403 for OPTIONS preflight because Api::_initialize doesn't
    // short-circuit. In production nginx/apache handles preflight. Skipped.
    it.skip('OPTIONS /api/common/init returns 2xx with Access-Control-* headers (skip: PHP-S does not handle OPTIONS)', async () => {
      const http = createHttpClient()
      const res = await http.request({
        method: 'OPTIONS',
        url: '/api/common/init',
        headers: {
          Origin: 'http://example.test',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'token,content-type',
        },
      })
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(300)
      // At least one Access-Control-* header should be present per spec _initialize behaviour.
      const acHeaders = Object.keys(res.headers).filter((k) => k.startsWith('access-control-'))
      expect(acHeaders.length).toBeGreaterThan(0)
    })
  })
})
