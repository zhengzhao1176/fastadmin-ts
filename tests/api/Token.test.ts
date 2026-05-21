// Black-box tests for api/Token controller (check, refresh).
// Spec: task/specs/api-Token.md
import { describe, it, expect, beforeAll } from 'vitest'
import { loginAsApiUser } from '../helpers/auth.ts'
import { unauthenticated } from '../helpers/auth.ts'
import type { HttpClient, Envelope } from '../helpers/http.ts'

// Per spec: Token = fast\Random::uuid() (UUID v4 string). Accept v4 hex shape.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Spec: Token::set(..., 2592000) → 30-day TTL on refreshed tokens.
const TOKEN_TTL_SECONDS = 2592000

interface TokenData {
  token: string
  expires_in: number
}

async function callCheck(http: HttpClient): Promise<Envelope<TokenData>> {
  return http.json<TokenData>({ method: 'GET', url: '/api/token/check' })
}

async function callRefresh(http: HttpClient): Promise<Envelope<TokenData>> {
  return http.json<TokenData>({ method: 'POST', url: '/api/token/refresh' })
}

describe('api/Token', () => {
  let initialToken: string
  let http: HttpClient

  beforeAll(async () => {
    // Get a fresh login each test suite so we have a known valid starting token.
    http = await loginAsApiUser('alice')
    initialToken = http.getToken() ?? ''
    expect(initialToken).toMatch(UUID_V4_RE)
  })

  describe('check', () => {
    it('returns token and expires_in for a valid token', async () => {
      // Use a separate logged-in client so other tests can mutate state freely.
      const client = await loginAsApiUser('alice')
      const startTok = client.getToken()!

      const res = await callCheck(client)

      expect(res.code).toBe(1)
      expect(typeof res.msg).toBe('string')
      expect(res.data).toBeDefined()
      expect(res.data.token).toBe(startTok)
      expect(res.data.token).toMatch(UUID_V4_RE)
      // expires_in is remaining seconds; for a just-issued token it should be
      // close to the configured 30-day TTL (allow slack for clock + dispatch).
      expect(typeof res.data.expires_in).toBe('number')
      expect(res.data.expires_in).toBeGreaterThan(0)
      expect(res.data.expires_in).toBeLessThanOrEqual(TOKEN_TTL_SECONDS)
    })

    it('rejects an invalid token with 401', async () => {
      const client = unauthenticated()
      // Well-formed UUID v4 string that was never issued by the server.
      client.setToken('11111111-1111-4111-8111-111111111111')

      const res = await callCheck(client)

      // Per spec: parent Api::_initialize rejects with code 401 / "Please login first".
      expect(res.code).toBe(401)
      expect(typeof res.msg).toBe('string')
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it('rejects a missing token with 401', async () => {
      const client = unauthenticated()
      // No token set at all → noNeedLogin = [] means every action needs auth.

      const res = await callCheck(client)

      expect(res.code).toBe(401)
    })
  })

  describe('refresh', () => {
    it('issues a new token and invalidates the old one', async () => {
      const client = await loginAsApiUser('alice')
      const oldToken = client.getToken()!
      expect(oldToken).toMatch(UUID_V4_RE)

      const res = await callRefresh(client)

      // 1) Success envelope with a fresh UUID v4 token + 30-day expires_in.
      expect(res.code).toBe(1)
      const newToken = res.data?.token
      expect(newToken).toBeDefined()
      expect(newToken).toMatch(UUID_V4_RE)
      expect(newToken).not.toBe(oldToken)
      expect(res.data.expires_in).toBeGreaterThan(0)
      expect(res.data.expires_in).toBeLessThanOrEqual(TOKEN_TTL_SECONDS)

      // 2) Old token must be rejected on the next request.
      const stale = unauthenticated()
      stale.setToken(oldToken)
      const staleRes = await callCheck(stale)
      expect(staleRes.code).toBe(401)

      // 3) The new token must work — switch the client over and call check.
      client.setToken(newToken)
      const freshRes = await callCheck(client)
      expect(freshRes.code).toBe(1)
      expect(freshRes.data.token).toBe(newToken)
    })

    it('rejects refresh with an invalid old token (401)', async () => {
      const client = unauthenticated()
      client.setToken('22222222-2222-4222-8222-222222222222')

      const res = await callRefresh(client)

      // Parent _initialize intercepts before the controller body runs.
      expect(res.code).toBe(401)
      expect(typeof res.msg).toBe('string')
      expect(res.msg.length).toBeGreaterThan(0)
    })

    it('rejects refresh with no token (401)', async () => {
      const client = unauthenticated()

      const res = await callRefresh(client)

      expect(res.code).toBe(401)
    })
  })
})
