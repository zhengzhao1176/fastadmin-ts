// In-process cron scheduler — the TS port of FastAdmin's crontab-driven
// scheduled tasks. Unlike PHP (where the OS crontab invokes `php think`),
// this runs inside the Nest process: a single 60s tick checks every
// registered task's cron expression against the current minute.
//
// NO-OP safe: with zero tasks registered, the tick still fires but does
// nothing. The timer is `unref`'d so it never holds the event loop open,
// and `OnModuleDestroy` clears it so the process exits cleanly.
import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common'
import { cronMatches } from '../common/cron-matcher.ts'

const TICK_MS = 60_000

interface ScheduledTask {
  name: string
  cron: string
  task: () => Promise<void>
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private tasks = new Map<string, ScheduledTask>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTickMinute = -1

  /**
   * Register (or replace) a cron task. `cronExpr` is a 5-field expression
   * (minute hour day month weekday). Throwing the same name twice replaces.
   */
  schedule(name: string, cronExpr: string, task: () => Promise<void>): void {
    this.tasks.set(name, { name, cron: cronExpr, task })
  }

  /** Remove a registered task. */
  unschedule(name: string): void {
    this.tasks.delete(name)
  }

  /** Registered tasks (name + cron expression). */
  list(): Array<{ name: string; cron: string }> {
    return Array.from(this.tasks.values()).map((t) => ({ name: t.name, cron: t.cron }))
  }

  onModuleInit(): void {
    // Tick every 60s. Guard against double-fire within the same wall-clock
    // minute (interval drift) so a task can't run twice for one minute.
    this.timer = setInterval(() => { void this.tick(new Date()) }, TICK_MS)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.tasks.clear()
  }

  /**
   * Run every task whose cron matches `now`. Exposed for tests / manual
   * triggering. Each task is awaited independently; a throw is logged and
   * does not abort the others.
   */
  async tick(now: Date): Promise<void> {
    const minute = now.getHours() * 60 + now.getMinutes()
    if (minute === this.lastTickMinute) return
    this.lastTickMinute = minute

    for (const t of this.tasks.values()) {
      if (!cronMatches(t.cron, now)) continue
      try {
        await t.task()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[scheduler] task "${t.name}" failed:`, err)
      }
    }
  }
}
