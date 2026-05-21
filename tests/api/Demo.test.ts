// Black-box integration tests for api/Demo controller.
// Spec source: task/specs/api-Demo.md
import { describe, it, expect } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'
import { loginAsApiUser, unauthenticated } from '../helpers/auth.ts'

describe('api/Demo', () => {
  describe('test', () => {
    // Spec: `test` is in noNeedLogin => no auth required; echoes request params.
    it('echoes posted params as data on success (no token needed)', async () => {
      const http = unauthenticated()
      const body = { id: 1, name: 'alice', data: { user_id: 1, user_name: 'alice' } }
      const r = await http.json<Record<string, unknown>>({
        method: 'POST',
        url: '/api/demo/test',
        json: body,
      })
      expect(r.code).toBe(1)
      expect(typeof r.msg).toBe('string')
      expect(typeof r.time).toBe('string')
      expect(parseInt(r.time, 10)).toBeGreaterThan(0)
      // data is $this->request->param() — PHP receives all params as strings.
      expect(r.data).toMatchObject({ id: '1', name: 'alice' })
    })

    it('succeeds even with empty body (no validate() in controller)', async () => {
      // Spec note: "代码中未执行 validate()，缺失不会报错"
      const http = unauthenticated()
      const r = await http.json({ method: 'POST', url: '/api/demo/test' })
      expect(r.code).toBe(1)
    })
  })

  describe('test1', () => {
    // Spec: `test1` is in noNeedLogin => no token required; returns { action: 'test1' }.
    it('returns { action: "test1" } without any token', async () => {
      const http = unauthenticated()
      const r = await http.json<{ action: string }>({
        method: 'GET',
        url: '/api/demo/test1',
      })
      expect(r.code).toBe(1)
      expect(r.data).toEqual({ action: 'test1' })
      expect(typeof r.time).toBe('string')
    })

    it('also accepts POST (controller does not restrict HTTP method)', async () => {
      const http = unauthenticated()
      const r = await http.json<{ action: string }>({
        method: 'POST',
        url: '/api/demo/test1',
      })
      expect(r.code).toBe(1)
      expect(r.data).toEqual({ action: 'test1' })
    })
  })

  describe('test2', () => {
    // Spec: `test2` requires Token (NOT in noNeedLogin); hits noNeedRight so skips
    // permission node check. Missing/invalid token => HTTP 401 from Api::_initialize.
    it('returns { action: "test2" } when called with a valid api token', async () => {
      const http = await loginAsApiUser('alice')
      const r = await http.json<{ action: string }>({
        method: 'GET',
        url: '/api/demo/test2',
      })
      expect(r.code).toBe(1)
      expect(r.data).toEqual({ action: 'test2' })
    })

    it('rejects with 401 when no token is provided', async () => {
      // Spec failure row: "未携带 Token 或 Token 无效" => http 401, code 401.
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/api/demo/test2' })
      expect(r.status).toBe(401)
      expect(typeof r.body).toBe('object')
      const env = r.body as unknown as { code: number; msg: string }
      expect(env.code).toBe(401)
      expect(env.msg.length).toBeGreaterThan(0)
    })

    it('rejects with 401 when token is invalid', async () => {
      const http = createHttpClient()
      http.setToken('not-a-real-token-' + Date.now().toString(36))
      const r = await http.request({ method: 'GET', url: '/api/demo/test2' })
      expect(r.status).toBe(401)
      const env = r.body as unknown as { code: number }
      expect(env.code).toBe(401)
    })
  })

  describe('test3', () => {
    // Spec: `test3` requires Token AND permission node `demo/test3`.
    // Unclear from code: "默认安装的会员组是否包含该节点，由数据库种子决定，
    // 本次未读取数据库初始化文件" — so we cannot assert the happy path.

    it.skip('returns { action: "test3" } for a user whose group has demo/test3 node', () => {
      // Skipped — quote from spec:
      // "Unclear from code: 默认安装的会员组是否包含该节点，由数据库种子决定，
      //  本次未读取数据库初始化文件"
    })

    it('rejects with 401 when no token is provided', async () => {
      // Spec failure row: "未携带 Token 或 Token 无效" => 401.
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/api/demo/test3' })
      expect(r.status).toBe(401)
      const env = r.body as unknown as { code: number; msg: string }
      expect(env.code).toBe(401)
      expect(env.msg.length).toBeGreaterThan(0)
    })

    it('rejects with 401 when token is invalid', async () => {
      const http = createHttpClient()
      http.setToken('bogus-token-' + Date.now().toString(36))
      const r = await http.request({ method: 'GET', url: '/api/demo/test3' })
      expect(r.status).toBe(401)
      const env = r.body as unknown as { code: number }
      expect(env.code).toBe(401)
    })

    it.skip('rejects with 403 when logged-in user lacks demo/test3 permission', () => {
      // Spec failure row: "已登录但无 demo/test3 权限节点 => http 403, code 403,
      //   msg __('You have no permission')". Skipped because — quote from spec —
      // "默认安装的会员组是否包含该节点，由数据库种子决定，本次未读取数据库初始化文件"
      // — without that ground truth we cannot reliably pick a user that is logged in
      // yet provably lacks the node. Re-enable once seed truth is recorded.
    })
  })
})
