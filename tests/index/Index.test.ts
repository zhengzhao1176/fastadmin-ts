// Black-box tests for `index/Index` controller. Spec at task/specs/index-Index.md.
// The controller exposes a single public action: `index`. It is marked
// `$noNeedLogin = '*'` / `$noNeedRight = '*'` so anonymous GET must succeed
// with rendered HTML (no envelope, no redirect to login).
import { describe, it, expect } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'

describe('index/Index', () => {
  describe('index', () => {
    it('GET /index/index/index returns 200 HTML without auth', async () => {
      const http = createHttpClient()
      const res = await http.request({ method: 'GET', url: '/index/index/index' })

      expect(res.status).toBe(200)
      expect(typeof res.body).toBe('string')
      const html = res.body as unknown as string
      expect(html.length).toBeGreaterThan(0)
      // Content-Type should advertise HTML (per spec "成功响应: text/html").
      const ct = res.headers['content-type'] ?? ''
      expect(ct.toLowerCase()).toContain('text/html')
      // No login redirect (Frontend::_initialize should be short-circuited by
      // `$noNeedLogin = '*'`, so no Location: /index/user/login).
      expect(res.headers['location']).toBeUndefined()
    })

    it('GET /index/index also resolves to the index action (default action)', async () => {
      const http = createHttpClient()
      const res = await http.request({ method: 'GET', url: '/index/index' })

      expect(res.status).toBe(200)
      expect(typeof res.body).toBe('string')
      expect((res.body as unknown as string).length).toBeGreaterThan(0)
    })

    it('responds with an HTML document shell (renders a template, not an envelope)', async () => {
      // Spec: `$this->view->fetch()` renders `view/index/index.html`. The exact
      // DOM is unread (see "Unclear from code" below), so we only assert the
      // response is HTML-shaped (not a JSON envelope) and non-empty.
      const http = createHttpClient()
      const html = await http.html({ method: 'GET', url: '/index/index/index' })

      expect(html.length).toBeGreaterThan(0)
      // Looks like HTML rather than a JSON success envelope.
      expect(html).not.toMatch(/^\s*\{\s*"code"\s*:/)
      // Must contain at least one HTML tag (cheap sanity check).
      expect(html).toMatch(/<[a-z!][^>]*>/i)
    })

    // Spec section "Ambiguities / Unclear from code":
    //   "模板 view/index/index.html 的 DOM 结构未读取（受 recon 文件清单限制），
    //    具体可断言的元素选择器需在后续步骤补齐。"
    // Until the template is read in a follow-up recon pass, we cannot assert
    // concrete selectors / text. Keep a skipped placeholder so coverage is
    // explicit rather than silently missing.
    it.skip(
      'contains the documented key DOM markers (selectors TBD — template not in recon scope)',
      async () => {
        const http = createHttpClient()
        const html = await http.html({ method: 'GET', url: '/index/index/index' })
        // TODO: replace with real selectors once view/index/index.html is read.
        expect(html).toContain('<TBD>')
      },
    )

    // Spec section "Ambiguities / Unclear from code":
    //   "index() 方法对 HTTP 方法无显式限制，POST/PUT 等是否被框架层拒绝
    //    取决于路由配置，未在本次 recon 范围内确认。"
    it.skip(
      'method restriction for non-GET verbs is undetermined (route config unread)',
      async () => {
        const http = createHttpClient()
        const res = await http.request({ method: 'POST', url: '/index/index/index' })
        // TODO: confirm framework-level behaviour, then assert real status.
        expect(res.status).toBe(0)
      },
    )
  })
})
