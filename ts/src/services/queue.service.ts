// Redis-backed async job queue — the TS port of PHP FastAdmin's
// `extra/queue.php` (think-queue). Mirrors the cache.service.ts pattern:
//   - Redis store when `REDIS_HOST` (or `QUEUE_DRIVER=redis`) is set.
//   - In-memory store otherwise, so tests / no-Redis dev still work.
//
// Jobs live under the Redis list `queue:<name>`. `push` LPUSHes, `pop` RPOPs
// (FIFO). `process` starts a polling worker loop; `stopAll` kills every loop
// and is invoked on module destroy so the process can exit cleanly.
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { env } from '../common/env.ts'
import type Redis from 'ioredis'

const KEY_PREFIX = 'queue:'

export interface QueueStore {
  name: string
  push(queue: string, payload: string): Promise<void>
  pop(queue: string): Promise<string | null>
  size(queue: string): Promise<number>
}

// ---------- in-memory ----------
class MemoryQueueStore implements QueueStore {
  name = 'memory'
  private lists = new Map<string, string[]>()

  private list(queue: string): string[] {
    let l = this.lists.get(queue)
    if (!l) { l = []; this.lists.set(queue, l) }
    return l
  }
  async push(queue: string, payload: string): Promise<void> {
    this.list(queue).push(payload)
  }
  async pop(queue: string): Promise<string | null> {
    return this.list(queue).shift() ?? null
  }
  async size(queue: string): Promise<number> {
    return this.list(queue).length
  }
}

// ---------- redis ----------
class RedisQueueStore implements QueueStore {
  name = 'redis'
  constructor(private client: Redis) {}

  private key(queue: string): string { return KEY_PREFIX + queue }

  async push(queue: string, payload: string): Promise<void> {
    await this.client.lpush(this.key(queue), payload)
  }
  async pop(queue: string): Promise<string | null> {
    return this.client.rpop(this.key(queue))
  }
  async size(queue: string): Promise<number> {
    return this.client.llen(this.key(queue))
  }
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private store: QueueStore = new MemoryQueueStore()
  private timers = new Set<ReturnType<typeof setInterval>>()
  private running = new Set<string>()

  constructor() {
    void this.init().catch(() => { /* fall through to memory */ })
  }

  /** Pick the right store at boot. Falls back to memory if Redis fails. */
  private async init(): Promise<void> {
    const driver = env('QUEUE_DRIVER', '')
    if (driver === 'memory') return
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
        this.store = new RedisQueueStore(client)
        // eslint-disable-next-line no-console
        console.log('[queue] using redis at', host || '127.0.0.1')
        return
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[queue] redis unreachable, falling back to memory store')
      }
    }
  }

  /** Enqueue a job. Payload is JSON-serialised. */
  async push(queue: string, payload: unknown): Promise<void> {
    await this.store.push(queue, JSON.stringify({ payload }))
  }

  /** Dequeue the oldest job (FIFO), or null when empty. */
  async pop(queue: string): Promise<unknown | null> {
    const raw = await this.store.pop(queue)
    if (raw == null) return null
    try {
      return (JSON.parse(raw) as { payload: unknown }).payload
    } catch {
      return null
    }
  }

  /** Number of pending jobs in a queue. */
  size(queue: string): Promise<number> {
    return this.store.size(queue)
  }

  /**
   * Start a worker loop: poll `queue`, run `handler` for each job. Drains all
   * available jobs every tick. A handler throw is swallowed (job is dropped)
   * so one bad job can't wedge the loop.
   */
  process(queue: string, handler: (payload: unknown) => Promise<void>, opts?: { intervalMs?: number }): void {
    const interval = opts?.intervalMs ?? 1000
    const timer = setInterval(() => {
      if (this.running.has(queue)) return // skip overlapping ticks
      this.running.add(queue)
      void (async () => {
        try {
          for (;;) {
            const job = await this.pop(queue)
            if (job == null) break
            try {
              await handler(job)
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(`[queue] handler error on "${queue}":`, err)
            }
          }
        } finally {
          this.running.delete(queue)
        }
      })()
    }, interval)
    if (typeof timer.unref === 'function') timer.unref()
    this.timers.add(timer)
  }

  /** Stop every worker loop started by `process`. */
  stopAll(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers.clear()
    this.running.clear()
  }

  /** Active store name — `redis` or `memory`. */
  driver(): string {
    return this.store.name
  }

  onModuleDestroy(): void {
    this.stopAll()
  }
}
