// Unit coverage for Http.sendRequest — doc 1264 (`\fast\Http::sendRequest`).
// The failure path is deterministic (connection refused on a dead port) so it
// needs no live server.
import { describe, expect, it } from 'vitest'
import { sendRequest, Http } from '../../ts/src/common/http.ts'

describe('Http.sendRequest', () => {
  it('resolves (does not throw) with ret:false on a network error', async () => {
    // Port 1 has nothing listening → connection refused.
    const r = await sendRequest('http://127.0.0.1:1/nothing', {}, 'GET', { timeout: 2000 })
    expect(r.ret).toBe(false)
    expect(r.httpcode).toBe(0)
    expect(typeof r.msg).toBe('string')
  })
  it('is exposed on the Http facade', () => {
    expect(typeof Http.sendRequest).toBe('function')
    expect(typeof Http.get).toBe('function')
    expect(typeof Http.post).toBe('function')
  })
})
