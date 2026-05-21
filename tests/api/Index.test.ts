// Black-box integration tests for `api/Index` controller.
// Spec: task/specs/api-Index.md
//   - Controller has `$noNeedLogin = ['*']` and `$noNeedRight = ['*']` → all actions are auth-free.
//   - Only one action: `index` → GET|POST `/api/index/index` returns success envelope.
import { describe, it, expect } from 'vitest'
import { createHttpClient, type Envelope } from '../helpers/http.ts'

describe('api/Index', () => {
  describe('index', () => {
    it('GET returns success envelope without auth', async () => {
      const http = createHttpClient()
      const res = await http.request<unknown>({ method: 'GET', url: '/api/index/index' })

      expect(res.status).toBe(200)
      expect(typeof res.body).toBe('object')
      const env = res.body as unknown as Envelope<unknown>
      expect(env.code).toBe(1)
      expect(env.msg).toBe('请求成功')
      expect(env.data).toBeNull()
      // time is a STRING per FastAdmin convention (07-conventions.md)
      expect(typeof env.time).toBe('string')
      expect(env.time.length).toBeGreaterThan(0)
      expect(Number.isFinite(parseInt(env.time, 10))).toBe(true)
    })

    it('POST also returns success envelope (no HTTP-method restriction)', async () => {
      const http = createHttpClient()
      const env = await http.json<unknown>({ method: 'POST', url: '/api/index/index', form: {} })

      expect(env.code).toBe(1)
      expect(env.msg).toBe('请求成功')
      expect(env.data).toBeNull()
      expect(typeof env.time).toBe('string')
    })

    it('does not require or set a token (no Authorization needed)', async () => {
      const http = createHttpClient()
      expect(http.getToken()).toBeNull()
      const env = await http.json<unknown>({ method: 'GET', url: '/api/index/index' })
      expect(env.code).toBe(1)
      // client still has no token after the call
      expect(http.getToken()).toBeNull()
    })
  })
})
