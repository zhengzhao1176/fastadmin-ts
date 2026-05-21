// Cache service with three pluggable stores. Selected by `CACHE_DRIVER` env:
//   - `redis` (default if REDIS_HOST is set) — ioredis-backed, persistent
//   - `file`  — JSON files under ts/runtime/cache/, atomic writes
//   - `memory`— Map<string, {v, exp}>, lost on restart (good for tests)
//
// Falls back to `file` automatically if Redis can't be reached at boot.
// Wired into admin/Ajax::wipecache so the test env's `type=all|content|template`
// branches actually clear something instead of being a no-op.
import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../common/env.ts'
import type Redis from 'ioredis'

export interface CacheStore {
  name: string
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSec?: number): Promise<void>
  rm(key: string): Promise<void>
  clear(prefix?: string): Promise<void>
  has(key: string): Promise<boolean>
}

// ---------- in-memory ----------
class MemoryCacheStore implements CacheStore {
  name = 'memory'
  private map = new Map<string, { v: string; exp: number }>()

  async get<T>(key: string): Promise<T | null> {
    const e = this.map.get(key)
    if (!e) return null
    if (e.exp > 0 && e.exp < Date.now()) {
      this.map.delete(key)
      return null
    }
    return JSON.parse(e.v) as T
  }
  async set<T>(key: string, value: T, ttlSec = 0): Promise<void> {
    this.map.set(key, { v: JSON.stringify(value), exp: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0 })
  }
  async rm(key: string): Promise<void> { this.map.delete(key) }
  async clear(prefix?: string): Promise<void> {
    if (!prefix) { this.map.clear(); return }
    for (const k of Array.from(this.map.keys())) if (k.startsWith(prefix)) this.map.delete(k)
  }
  async has(key: string): Promise<boolean> { return (await this.get(key)) !== null }
}

// ---------- file ----------
class FileCacheStore implements CacheStore {
  name = 'file'
  private root: string

  constructor() {
    this.root = path.resolve(process.cwd(), 'runtime', 'cache')
    fs.mkdirSync(this.root, { recursive: true })
  }
  private pathFor(key: string): string {
    const safe = Buffer.from(key, 'utf8').toString('base64url')
    return path.join(this.root, safe + '.json')
  }
  async get<T>(key: string): Promise<T | null> {
    const p = this.pathFor(key)
    if (!fs.existsSync(p)) return null
    try {
      const { v, exp } = JSON.parse(fs.readFileSync(p, 'utf8')) as { v: T; exp: number }
      if (exp > 0 && exp < Date.now()) { fs.unlinkSync(p); return null }
      return v
    } catch { return null }
  }
  async set<T>(key: string, value: T, ttlSec = 0): Promise<void> {
    const p = this.pathFor(key)
    const tmp = p + '.tmp'
    const payload = JSON.stringify({ v: value, exp: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0 })
    fs.writeFileSync(tmp, payload)
    fs.renameSync(tmp, p)
  }
  async rm(key: string): Promise<void> {
    const p = this.pathFor(key)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  async clear(prefix?: string): Promise<void> {
    if (!fs.existsSync(this.root)) return
    if (!prefix) {
      for (const f of fs.readdirSync(this.root)) fs.unlinkSync(path.join(this.root, f))
      return
    }
    for (const f of fs.readdirSync(this.root)) {
      try {
        const key = Buffer.from(f.replace(/\.json$/, ''), 'base64url').toString('utf8')
        if (key.startsWith(prefix)) fs.unlinkSync(path.join(this.root, f))
      } catch { /* ignore */ }
    }
  }
  async has(key: string): Promise<boolean> { return (await this.get(key)) !== null }
}

// ---------- redis ----------
class RedisCacheStore implements CacheStore {
  name = 'redis'
  constructor(private client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const v = await this.client.get(key)
    if (v == null) return null
    try { return JSON.parse(v) as T } catch { return null }
  }
  async set<T>(key: string, value: T, ttlSec = 0): Promise<void> {
    const payload = JSON.stringify(value)
    if (ttlSec > 0) await this.client.set(key, payload, 'EX', ttlSec)
    else await this.client.set(key, payload)
  }
  async rm(key: string): Promise<void> { await this.client.del(key) }
  async clear(prefix?: string): Promise<void> {
    if (!prefix) { await this.client.flushdb(); return }
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 100)
      cursor = next
      if (keys.length > 0) await this.client.del(...keys)
    } while (cursor !== '0')
  }
  async has(key: string): Promise<boolean> { return (await this.client.exists(key)) === 1 }
}

@Injectable()
export class CacheService {
  private store: CacheStore = new MemoryCacheStore()

  constructor() {
    void this.init().catch(() => { /* fall through to memory */ })
  }

  /** Pick the right store at boot based on env. Sync fallbacks if Redis fails. */
  private async init(): Promise<void> {
    const driver = env('CACHE_DRIVER', '')
    if (driver === 'memory') return
    if (driver === 'file') { this.store = new FileCacheStore(); return }
    // Default: try redis if REDIS_HOST configured; fall back to file.
    const host = env('REDIS_HOST', '')
    if (driver === 'redis' || host) {
      try {
        const { default: IORedis } = await import('ioredis')
        const client = new IORedis({
          host: host || '127.0.0.1',
          port: Number(env('REDIS_PORT', '6379')) || 6379,
          db: Number(env('REDIS_DB', '0')) || 0,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 1500,
        })
        await client.connect()
        await client.ping()
        this.store = new RedisCacheStore(client)
        // eslint-disable-next-line no-console
        console.log('[cache] using redis at', host || '127.0.0.1')
        return
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[cache] redis unreachable, falling back to file store')
      }
    }
    this.store = new FileCacheStore()
  }

  get<T>(key: string): Promise<T | null> { return this.store.get(key) }
  set<T>(key: string, value: T, ttlSec?: number): Promise<void> { return this.store.set(key, value, ttlSec) }
  rm(key: string): Promise<void> { return this.store.rm(key) }
  clear(prefix?: string): Promise<void> { return this.store.clear(prefix) }
  has(key: string): Promise<boolean> { return this.store.has(key) }
  driver(): string { return this.store.name }
}
