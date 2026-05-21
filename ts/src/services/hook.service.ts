// PHP's `Hook::listen` / `Hook::add` ported to a tiny event-emitter style
// service. Used by addons (D03) and the frontend user controller (cookie
// setting on register / login / logout).
import { Injectable } from '@nestjs/common'

export type HookHandler<T = unknown> = (params: T) => unknown | Promise<unknown>

export interface ListenResult<T> {
  params: T
  errors: Error[]
}

@Injectable()
export class HookService {
  private handlers = new Map<string, HookHandler[]>()

  add<T>(event: string, handler: HookHandler<T>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler as HookHandler)
  }

  remove<T>(event: string, handler: HookHandler<T>): void {
    const arr = this.handlers.get(event)
    if (!arr) return
    const idx = arr.indexOf(handler as HookHandler)
    if (idx >= 0) arr.splice(idx, 1)
  }

  has(event: string): boolean {
    return (this.handlers.get(event)?.length ?? 0) > 0
  }

  /**
   * Run all handlers for `event` in registration order. Handlers receive the
   * same `params` object and may mutate it. A thrown error from one handler
   * does NOT stop the chain — it's collected and returned in `errors`.
   */
  async listen<T>(event: string, params: T): Promise<ListenResult<T>> {
    const errors: Error[] = []
    const arr = this.handlers.get(event) ?? []
    for (const h of arr) {
      try {
        await h(params)
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)))
      }
    }
    return { params, errors }
  }

  /**
   * Synchronous filter chain — thread `value` through every handler in
   * registration order. A handler may return the replacement value, or mutate
   * `value` in place and return nothing. Used by sync contexts (e.g.
   * `ViewService.render` → the `view_filter` hook) where `listen()` cannot be
   * awaited. Promise-returning handlers are not awaited — `filter` is sync by
   * contract — and a thrown handler is swallowed so it can't break rendering.
   */
  filter<T>(event: string, value: T): T {
    let cur = value
    for (const h of this.handlers.get(event) ?? []) {
      try {
        const r = h(cur)
        if (r !== undefined && !(r instanceof Promise)) cur = r as T
      } catch {
        // a misbehaving filter must not break the caller
      }
    }
    return cur
  }
}
