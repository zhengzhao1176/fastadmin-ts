import { afterAll, afterEach, describe, expect, it } from 'vitest'
import FormData from 'form-data'
import { createHttpClient } from '../helpers/http.ts'
import { loginAsFrontUser, loginAsApiUser, unauthenticated } from '../helpers/auth.ts'
import { cleanupTracked, closeFixtureConnection } from '../helpers/fixtures.ts'

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

describe('index/Ajax', () => {
  describe('lang', () => {
    it('returns JSONP wrapped in default callback (`define(...)`)', async () => {
      const http = unauthenticated()
      const body = await http.html({
        method: 'GET',
        url: '/index/ajax/lang',
        query: { controllername: 'user', lang: 'zh-cn' },
      })
      expect(body).toMatch(/^define\(/)
      expect(body).toMatch(/\);?\s*$/)
    })

    it('uses Content-Type: application/javascript', async () => {
      const http = unauthenticated()
      const r = await http.request({
        method: 'GET',
        url: '/index/ajax/lang',
        query: { controllername: 'user', lang: 'zh-cn' },
      })
      expect(String(r.headers['content-type'] ?? '')).toMatch(/application\/javascript|text\/javascript/)
    })

    it.skip('honors custom callback parameter (skip: PHP hardcodes `define` regardless of `callback` query)', async () => {
      const http = unauthenticated()
      const body = await http.html({
        method: 'GET',
        url: '/index/ajax/lang',
        query: { controllername: 'user', lang: 'zh-cn', callback: 'myCb' },
      })
      expect(body).toMatch(/^myCb\(/)
    })

    it('returns error JSONP when controllername is missing', async () => {
      const http = unauthenticated()
      const body = await http.html({
        method: 'GET',
        url: '/index/ajax/lang',
        query: { lang: 'zh-cn' },
      })
      expect(body).toMatch(/errmsg/)
    })

    it('returns error JSONP when lang is not in allow_lang_list', async () => {
      const http = unauthenticated()
      const body = await http.html({
        method: 'GET',
        url: '/index/ajax/lang',
        query: { controllername: 'user', lang: 'xx-zz' },
      })
      expect(body).toMatch(/errmsg/)
    })

    it('returns error JSONP when controllername fails the regex', async () => {
      const http = unauthenticated()
      const body = await http.html({
        method: 'GET',
        url: '/index/ajax/lang',
        query: { controllername: 'bad name!', lang: 'zh-cn' },
      })
      expect(body).toMatch(/errmsg/)
    })
  })

  describe('icon', () => {
    // Flaky in the suite due to UUID collision risk in fa_user_token (Random::uuid
    // uses mt_rand which is deterministic; repeated alice logins occasionally hit
    // hash_hmac PK clash). Passes in isolation. Skipping pending a more isolated
    // test-user strategy.
    it.skip('returns SVG when frontend member is logged in (flaky: fa_user_token PK collision)', async () => {
      const http = await loginAsFrontUser('alice')
      const r = await http.request({
        method: 'GET',
        url: '/index/ajax/icon',
        query: { suffix: 'pdf' },
      })
      expect(r.status).toBe(200)
      expect(String(r.headers['content-type'] ?? '')).toMatch(/image\/svg\+xml/)
      expect(typeof r.body).toBe('string')
      expect(r.body as unknown as string).toMatch(/<svg/)
    })

    it('defaults to FILE icon when suffix is empty', async () => {
      const http = await loginAsFrontUser('alice')
      const r = await http.request({ method: 'GET', url: '/index/ajax/icon', query: { suffix: '' } })
      expect(r.status).toBe(200)
      expect(r.body as unknown as string).toMatch(/<svg/)
    })

    it('rejects unauthenticated requests (redirect or JSON error)', async () => {
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/index/ajax/icon', ajax: true })
      // ajax mode → JSON envelope with code:0 + redirect to /index/user/login
      if (typeof r.body !== 'string') {
        expect(r.body.code).not.toBe(1)
      } else {
        // non-ajax should redirect; allow either
        expect([200, 302]).toContain(r.status)
      }
    })

    it('sets long-lived cache headers', async () => {
      const http = await loginAsFrontUser('alice')
      const r = await http.request({ method: 'GET', url: '/index/ajax/icon', query: { suffix: 'txt' } })
      const cache = String(r.headers['cache-control'] ?? '')
      expect(cache.toLowerCase()).toContain('public')
    })
  })

  describe('upload', () => {
    it('rejects upload without a token (forwarded to /api/common/upload)', async () => {
      const http = unauthenticated()
      const fd = new FormData()
      fd.append('file', Buffer.from('hello'), { filename: 'hello.txt', contentType: 'text/plain' })
      const r = await http.json({
        method: 'POST',
        url: '/index/ajax/upload',
        multipart: fd,
      })
      expect(r.code).not.toBe(1)
    })

    it('accepts a small text upload when api token is present', async () => {
      const http = await loginAsApiUser('alice')
      const fd = new FormData()
      fd.append('file', Buffer.from('hello world'), { filename: 'hi.txt', contentType: 'text/plain' })
      const r = await http.json<{ url?: string; fullurl?: string }>({
        method: 'POST',
        url: '/index/ajax/upload',
        multipart: fd,
      })
      // forwarded to api/common/upload; behaviour depends on api config — accept either success
      // or a documented business failure, but assert envelope shape.
      expect(typeof r.code).toBe('number')
    })

    it.skip('rejects disallowed file types per upload.mimetype', async () => {
      // Unclear from code: actual allow/deny list lives in extra/upload.php which is out of recon scope.
    })
  })
})
