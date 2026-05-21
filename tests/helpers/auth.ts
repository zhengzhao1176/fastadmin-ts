// Login helpers. Returns a pre-authenticated HttpClient ready to hit protected
// endpoints. Failed logins throw AuthError rather than returning a half-state.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHttpClient, type HttpClient } from './http.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_PATH = path.resolve(__dirname, '../fixtures/seed-data.json')

interface SeedAdmin { username: string; password: string }
interface SeedUser { username: string; password: string; status?: string }
interface Seed {
  admin: { super: SeedAdmin; subadmin: SeedAdmin }
  user: { alice: SeedUser; bob: SeedUser; banned: SeedUser }
}

let cachedSeed: Seed | null = null
function loadSeed(): Seed {
  if (cachedSeed) return cachedSeed
  cachedSeed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Seed
  return cachedSeed
}

export class AuthError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'AuthError'
  }
}

export type AdminName = keyof Seed['admin']
export type UserName = keyof Seed['user']

/** Log in to /admin.php as an admin and return the authenticated client. */
export async function loginAsAdmin(account: AdminName = 'super'): Promise<HttpClient> {
  const seed = loadSeed()
  const cred = seed.admin[account]
  if (!cred) throw new AuthError(`unknown admin account: ${account}`)

  const http = createHttpClient()
  const token = await http.fetchToken('/admin/index/login')
  const r = await http.json({
    method: 'POST',
    url: '/admin/index/login',
    form: {
      username: cred.username,
      password: cred.password,
      keeplogin: 0,
      __token__: token,
    },
  })
  if (r.code !== 1) {
    throw new AuthError(`admin login failed: ${r.msg}`, r.code)
  }
  return http
}

interface ApiUserinfo { id: number; username: string; token: string; user_id: number }

/** Log in to /api/user/login and return a token-bearing client. */
export async function loginAsApiUser(account: UserName = 'alice'): Promise<HttpClient> {
  const seed = loadSeed()
  const cred = seed.user[account]
  if (!cred) throw new AuthError(`unknown user account: ${account}`)

  const http = createHttpClient()
  const r = await http.json<{ userinfo: ApiUserinfo }>({
    method: 'POST',
    url: '/api/user/login',
    form: { account: cred.username, password: cred.password },
  })
  if (r.code !== 1) {
    throw new AuthError(`api login failed: ${r.msg}`, r.code)
  }
  const token = r.data?.userinfo?.token
  if (!token) {
    throw new AuthError(`api login returned no token (msg=${r.msg})`)
  }
  http.setToken(token)
  return http
}

/** Log in to /index/user/login (frontend session). */
export async function loginAsFrontUser(account: 'alice' | 'bob' = 'alice'): Promise<HttpClient> {
  const seed = loadSeed()
  const cred = seed.user[account]

  const http = createHttpClient()
  const token = await http.fetchToken('/index/user/login')
  const r = await http.json({
    method: 'POST',
    url: '/index/user/login',
    form: {
      account: cred.username,
      password: cred.password,
      keeplogin: 0,
      __token__: token,
    },
  })
  if (r.code !== 1) {
    throw new AuthError(`frontend login failed: ${r.msg}`, r.code)
  }
  return http
}

/** Unauthenticated client (still has a fresh cookie jar). */
export function unauthenticated(): HttpClient {
  return createHttpClient()
}
