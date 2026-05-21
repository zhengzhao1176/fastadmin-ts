// Cross-cutting: Token lifecycle for the api module (token-based auth).
// Spec: task/30-cross-cutting/03-token-lifecycle.md
// Background (task/specs/api-Token.md, api-User.md, fastAdmin token driver):
//   - Login (/api/user/login) returns `data.userinfo.token` — a UUID v4 string
//     produced by fast\Random::uuid().
//   - Token persistence is driver-pluggable: `File` (default in framework
//     defaults), `Mysql`, `Redis`. THIS project's application/config.php
//     overrides `token.type = 'Mysql'` → fa_user_token table is the source of
//     truth here. We assert presence by `user_id` (the token column stores the
//     hash_hmac(ripemd160, raw_token, key) digest, not the raw uuid).
//   - /api/token/check returns { token, expires_in } for the active token.
//   - /api/token/refresh deletes the old token then writes a brand-new uuid;
//     old token is rejected on the next call.
//   - Logout deletes the active token.
//   - Setting `expiretime` to a past second makes the row act as expired (the
//     Mysql driver's get() short-circuits `expiretime > time()` and self-deletes).
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import type { RowDataPacket } from 'mysql2'
import { loginAsApiUser } from '../helpers/auth.ts'
import { createHttpClient, type Envelope } from '../helpers/http.ts'
import { cleanupTracked, closeFixtureConnection, makeUser } from '../helpers/fixtures.ts'
import { withApp } from '../../scripts/db.ts'

// UUID v4 / hex-with-dashes — task asks for /^[0-9a-f-]{20,}$/i which is the
// minimum lenient form. Random::uuid() produces 36-char canonical UUIDs.
const UUID_RE = /^[0-9a-f-]{20,}$/i

interface CheckData { token: string; expires_in: number }
interface RefreshData { token: string; expires_in: number }
interface UserinfoData { userinfo: { id: number; username: string; token: string } }

async function countTokensForUser(userId: number): Promise<number> {
  return withApp(async (db) => {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM fa_user_token WHERE user_id = ?',
      [userId],
    )
    return Number((rows[0] as { c: number } | undefined)?.c ?? 0)
  })
}

async function expireAllTokensForUser(userId: number): Promise<number> {
  // Bump expiretime to a past second; cleanup runs at most once per 86400s so
  // this won't be wiped synchronously by the driver's housekeeping unless the
  // cache key `tokentime` has not been bumped in the last 24h.
  return withApp(async (db) => {
    const past = Math.floor(Date.now() / 1000) - 3600
    const [res] = await db.query(
      'UPDATE fa_user_token SET expiretime = ? WHERE user_id = ? AND (expiretime = 0 OR expiretime > ?)',
      [past, userId, past],
    )
    return (res as { affectedRows: number }).affectedRows
  })
}

// Tracks fixture user_ids we logged in as, so we can wipe their fa_user_token
// rows (no FK cascade from fa_user → fa_user_token).
const tokenOwners = new Set<number>()

async function wipeTokensFor(userId: number): Promise<void> {
  await withApp(async (db) => {
    await db.query('DELETE FROM fa_user_token WHERE user_id = ?', [userId])
  })
}

describe('cross-cutting: Token lifecycle', () => {
  afterEach(async () => {
    for (const id of tokenOwners) await wipeTokensFor(id)
    tokenOwners.clear()
    await cleanupTracked()
  })

  afterAll(async () => {
    await closeFixtureConnection()
  })

  it('login returns a UUID-shaped token (seeded alice via loginAsApiUser)', async () => {
    const http = await loginAsApiUser('alice')
    const token = http.getToken()
    expect(typeof token).toBe('string')
    expect(token).toMatch(UUID_RE)
    // Seed user id is 1 (tests/fixtures/seed-data.json) — clean the row up.
    tokenOwners.add(1)
  })

  it('login persists a row in fa_user_token (Mysql driver active)', async () => {
    const user = await makeUser()
    const before = await countTokensForUser(user.id)
    expect(before).toBe(0)

    const http = await loginAsApiUserFor(user.username, user.password, user.id)
    expect(http.getToken()).toMatch(UUID_RE)

    const after = await countTokensForUser(user.id)
    expect(after).toBeGreaterThanOrEqual(1)
  })

  it('authenticated GET /api/user/index works, logout invalidates the token → 401', async () => {
    const user = await makeUser()
    const http = await loginAsApiUserFor(user.username, user.password, user.id)

    const ok = await http.json<{ welcome: string } | null>({ method: 'GET', url: '/api/user/index' })
    expect(ok.code).toBe(1)

    const out = await http.json({ method: 'POST', url: '/api/user/logout', form: {} })
    expect(out.code).toBe(1)

    // Re-using the now-deleted token must be rejected by Api::_initialize.
    const denied = await http.request<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(denied.status).toBe(401)
    const env = denied.body as Envelope<unknown>
    expect(env.code).toBe(401)
  })

  it('/api/token/check returns { token, expires_in } for the active token', async () => {
    const user = await makeUser()
    const http = await loginAsApiUserFor(user.username, user.password, user.id)
    const active = http.getToken()!

    const r = await http.json<CheckData>({ method: 'GET', url: '/api/token/check' })
    expect(r.code).toBe(1)
    expect(r.data.token).toBe(active)
    // Token default lifetime is 2592000s; allow a small margin for travel time.
    expect(r.data.expires_in).toBeGreaterThan(2592000 - 60)
    expect(r.data.expires_in).toBeLessThanOrEqual(2592000)
  })

  it('/api/token/refresh issues a new token AND the old one is immediately rejected', async () => {
    const user = await makeUser()
    const http = await loginAsApiUserFor(user.username, user.password, user.id)
    const oldToken = http.getToken()!

    const r = await http.json<RefreshData>({ method: 'POST', url: '/api/token/refresh', form: {} })
    expect(r.code).toBe(1)
    const newToken = r.data.token
    expect(newToken).toMatch(UUID_RE)
    expect(newToken).not.toBe(oldToken)
    expect(r.data.expires_in).toBeGreaterThan(2592000 - 60)

    // Old token: build a fresh client to avoid sharing internal state.
    const stale = createHttpClient()
    stale.setToken(oldToken)
    const oldRes = await stale.request<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(oldRes.status).toBe(401)

    // New token works for protected endpoints.
    const fresh = createHttpClient()
    fresh.setToken(newToken)
    const okEnv = await fresh.json<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(okEnv.code).toBe(1)
  })

  it('setting fa_user_token.expiretime to the past forces 401 on next request', async () => {
    const user = await makeUser()
    const http = await loginAsApiUserFor(user.username, user.password, user.id)

    // Sanity: the token works first.
    const before = await http.json<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(before.code).toBe(1)

    const updated = await expireAllTokensForUser(user.id)
    expect(updated).toBeGreaterThan(0)

    const after = await http.request<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(after.status).toBe(401)
    expect((after.body as Envelope<unknown>).code).toBe(401)
  })

  it('multiple concurrent tokens for the same user: login twice → two valid tokens', async () => {
    const user = await makeUser()
    const a = await loginAsApiUserFor(user.username, user.password, user.id)
    const b = await loginAsApiUserFor(user.username, user.password, user.id)

    const tokA = a.getToken()!
    const tokB = b.getToken()!
    expect(tokA).toMatch(UUID_RE)
    expect(tokB).toMatch(UUID_RE)
    expect(tokA).not.toBe(tokB)

    // Both rows present.
    const count = await countTokensForUser(user.id)
    expect(count).toBeGreaterThanOrEqual(2)

    // Both clients can hit a protected endpoint independently.
    const ra = await a.json<unknown>({ method: 'GET', url: '/api/user/index' })
    const rb = await b.json<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(ra.code).toBe(1)
    expect(rb.code).toBe(1)

    // Invalidating one (logout on a) must NOT invalidate the other.
    const out = await a.json({ method: 'POST', url: '/api/user/logout', form: {} })
    expect(out.code).toBe(1)

    const aGone = await a.request<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(aGone.status).toBe(401)
    const bStill = await b.json<unknown>({ method: 'GET', url: '/api/user/index' })
    expect(bStill.code).toBe(1)
  })

  // Production-only: Redis driver would require swapping `token.type` at runtime
  // and a live Redis. Out of scope for File/Mysql-default test env per task brief.
  it.skip('Redis driver: token lifecycle behaves the same as default driver', async () => {
    // Intentionally skipped — see task brief: default driver is File, Redis
    // verification is production-specific.
  })
})

// ---------- internal helpers ----------

// loginAsApiUser() reads from seed-data.json, but we need to log in as a
// freshly minted fixture user (so the row is owned by the test and cleaned
// up afterEach). This mirrors loginAsApiUser's implementation against
// makeUser-produced credentials.
async function loginAsApiUserFor(account: string, password: string, userId?: number) {
  const http = createHttpClient()
  const r = await http.json<UserinfoData>({
    method: 'POST',
    url: '/api/user/login',
    form: { account, password },
  })
  if (r.code !== 1 || !r.data?.userinfo?.token) {
    throw new Error(`api login failed for ${account}: code=${r.code} msg=${r.msg}`)
  }
  http.setToken(r.data.userinfo.token)
  if (userId != null) tokenOwners.add(userId)
  return http
}
