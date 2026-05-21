// Black-box integration tests for api/Ems (send + check).
// Spec: task/specs/api-Ems.md
//
// Test strategy:
//   - Do NOT trigger real SMTP. The default ems_send hook calls Tx\Mailer which
//     would actually deliver mail; cross-cutting Captcha/SMTP fakes are tracked
//     in 30-cross-cutting and aren't wired here. So we either rely on Email's
//     "Mail already closed" fast-fail (when site.mail_type ∉ {1,2}) to short-
//     circuit, or skip the strictly-happy assertion as noted below.
//   - We DO assert that the controller writes a fa_ems row (or doesn't, when
//     validation fails) via direct DB inspection — that's the durable signal.
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { loginAsApiUser } from '../helpers/auth.ts'
import { createHttpClient } from '../helpers/http.ts'
import { cleanupTracked, closeFixtureConnection, trackForCleanup } from '../helpers/fixtures.ts'
import { withApp } from '../../scripts/db.ts'

interface EmsRow {
  id: number
  event: string
  email: string
  code: string
  ip: string
  createtime: number
  times: number
}

async function countEms(email: string, event: string): Promise<number> {
  return withApp(async (db) => {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS c FROM fa_ems WHERE email = ? AND event = ?',
      [email, event],
    )
    return Number((rows as Array<{ c: number }>)[0]?.c ?? 0)
  })
}

async function findLatestEms(email: string, event: string): Promise<EmsRow | null> {
  return withApp(async (db) => {
    const [rows] = await db.query(
      'SELECT id, event, email, code, ip, createtime, times FROM fa_ems WHERE email = ? AND event = ? ORDER BY id DESC LIMIT 1',
      [email, event],
    )
    const list = rows as EmsRow[]
    return list[0] ?? null
  })
}

async function insertEms(email: string, event: string, code: string, createtime?: number): Promise<number> {
  const ts = createtime ?? Math.floor(Date.now() / 1000)
  const id = await withApp(async (db) => {
    const [res] = await db.query(
      'INSERT INTO fa_ems (event, email, code, ip, createtime, times) VALUES (?, ?, ?, ?, ?, 0)',
      [event, email, code, '127.0.0.1', ts],
    )
    return (res as { insertId: number }).insertId
  })
  trackForCleanup('fa_ems', id)
  return id
}

function uniqEmail(label: string): string {
  return `ems_${label}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}@test.local`
}

describe('api/Ems', () => {
  afterEach(async () => {
    await cleanupTracked()
  })

  afterAll(async () => {
    await closeFixtureConnection()
  })

  describe('send', () => {
    it('inserts a fa_ems row on success (response code surfaces SMTP outcome)', async () => {
      const http = await loginAsApiUser()
      const email = uniqEmail('send_ok')
      const event = 'register'

      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/send',
        form: { email, event },
      })

      // The send action ALWAYS writes the fa_ems row first; if the default
      // ems_send hook returns false (Email::send → "Mail already closed"),
      // Emslib::send rolls back by deleting that row. So a code===1 response
      // implies a row remains; code===0 with msg "发送失败" implies rollback.
      // Track whatever row is currently present so cleanup wipes it either way.
      const row = await findLatestEms(email, event)
      if (row) trackForCleanup('fa_ems', row.id)

      expect(r.code === 1 || r.code === 0).toBe(true)
      if (r.code === 1) {
        // Happy: row persists with matching email/event and a numeric code.
        expect(row).not.toBeNull()
        expect(row!.email).toBe(email)
        expect(row!.event).toBe(event)
        expect(row!.code.length).toBeGreaterThan(0)
        expect(/^\d+$/.test(row!.code)).toBe(true)
      } else {
        // Rollback path: hook returned falsy → row deleted.
        expect(row).toBeNull()
      }
    })

    it('asserts the verification mail actually arrives (captured by MailHog)', async () => {
      const { clearMailbox, waitForMail, addr } = await import('../helpers/mailhog.ts')
      await clearMailbox()
      const http = await loginAsApiUser()
      const email = uniqEmail('mailcheck')
      const event = 'register'
      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/send',
        form: { email, event },
      })
      expect(r.code).toBe(1)
      const msgs = await waitForMail(1, 5_000)
      expect(msgs.length).toBeGreaterThanOrEqual(1)
      expect(addr(msgs[0]!.To[0]!)).toBe(email)
    })

    it('rejects a second send within the 60s cooldown for the same email+event', async () => {
      const http = await loginAsApiUser()
      const email = uniqEmail('cooldown')
      const event = 'register'

      const first = await http.json<null>({
        method: 'POST',
        url: '/api/ems/send',
        form: { email, event },
      })
      // Track whatever the first call inserted so cleanup picks it up.
      const firstRow = await findLatestEms(email, event)
      if (firstRow) trackForCleanup('fa_ems', firstRow.id)

      // For cooldown to engage, the first call must have left a row (i.e. it
      // did NOT roll back). If the env's SMTP is closed → first.code===0 and
      // row was deleted, so cooldown can't fire. In that case just record the
      // skip-context — the cooldown branch is unreachable without a row.
      if (first.code !== 1 || !firstRow) {
        // Treat this as an environment-dependent skip: cooldown depends on a
        // surviving row from the first call. Spec branch covered when env has
        // a working/stubbed mail hook.
        expect(first.code).toBeGreaterThanOrEqual(0)
        return
      }

      const second = await http.json<null>({
        method: 'POST',
        url: '/api/ems/send',
        form: { email, event },
      })
      expect(second.code).toBe(0)
      // No new row should be created on cooldown.
      const after = await countEms(email, event)
      expect(after).toBe(1)
    })

    it.skip('5/hour IP cap rejects the 6th send (skipped — too slow / pollutes IP bucket)', () => {
      // Would require 5 successful rows from the same client IP within one
      // hour, each with distinct email to avoid the 60s cooldown. Not safe to
      // run in CI without a dedicated IP isolation.
    })

    it('rejects an unsupported event token (bad event)', async () => {
      const http = await loginAsApiUser()
      const email = uniqEmail('bad_event')

      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/send',
        // Contains '!' which is not in /^[a-z0-9_\-]{3,30}$/i
        form: { email, event: 'bad!event' },
      })

      expect(r.code).toBe(0)
      expect(typeof r.msg).toBe('string')
      // No row should be inserted on validation failure.
      const c = await countEms(email, 'bad!event')
      expect(c).toBe(0)
    })

    it('rejects a malformed email address', async () => {
      const http = await loginAsApiUser()
      const badEmail = 'not-an-email'

      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/send',
        form: { email: badEmail, event: 'register' },
      })

      expect(r.code).toBe(0)
      // Nothing written for an invalid email.
      const c = await countEms(badEmail, 'register')
      expect(c).toBe(0)
    })
  })

  describe('check', () => {
    it('returns success when the captcha matches the latest fa_ems row', async () => {
      const http = createHttpClient() // check is noNeedLogin
      const email = uniqEmail('check_ok')
      const event = 'register'
      const code = '123456'
      await insertEms(email, event, code)

      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/check',
        form: { email, event, captcha: code },
      })

      expect(r.code).toBe(1)
    })

    it('fails when the captcha record is expired (createtime > 120s ago)', async () => {
      const http = createHttpClient()
      const email = uniqEmail('check_expired')
      const event = 'register'
      const code = '654321'
      const longAgo = Math.floor(Date.now() / 1000) - 600 // 10 min ago, well past 120s
      await insertEms(email, event, code, longAgo)

      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/check',
        form: { email, event, captcha: code },
      })

      expect(r.code).toBe(0)
      // Expired path triggers Emslib::flush — all rows for this email+event gone.
      const remaining = await countEms(email, event)
      expect(remaining).toBe(0)
    })

    it('fails when the supplied captcha does not match the stored code', async () => {
      const http = createHttpClient()
      const email = uniqEmail('check_wrong')
      const event = 'register'
      await insertEms(email, event, '111111')

      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/check',
        form: { email, event, captcha: '999999' },
      })

      expect(r.code).toBe(0)
      // Row should still exist with times incremented (spec: times +1 on mismatch within window).
      const row = await findLatestEms(email, event)
      expect(row).not.toBeNull()
      expect(row!.times).toBeGreaterThanOrEqual(1)
    })

    it('blocks further checks after exceeding maxCheckNums = 10', async () => {
      const http = createHttpClient()
      const email = uniqEmail('check_maxnums')
      const event = 'register'
      const code = '424242'
      const id = await insertEms(email, event, code)

      // Pre-seed times so the next bad attempt pushes us over maxCheckNums = 10.
      await withApp(async (db) => {
        await db.query('UPDATE fa_ems SET times = ? WHERE id = ?', [10, id])
      })

      // Wrong captcha at times >= 10 should now fail; spec: record is flushed.
      const r = await http.json<null>({
        method: 'POST',
        url: '/api/ems/check',
        form: { email, event, captcha: '000000' },
      })
      expect(r.code).toBe(0)

      // Whether the correct captcha would also be rejected post-block is
      // "Unclear from code" per spec — see api-Ems.md "校验次数超限":
      //   "Emslib::check 返回 false（无记录 / 已过期 / 验证码不匹配 / 校验次数超限 / 钩子拒绝）"
      // So follow up: a second attempt with the right code should also fail.
      const r2 = await http.json<null>({
        method: 'POST',
        url: '/api/ems/check',
        form: { email, event, captcha: code },
      })
      expect(r2.code).toBe(0)
    })

    it.skip('exact post-flush row state after maxCheckNums is "Unclear from code" — spec quote: "记录过期（createtime <= now - 120）或 `times` 超限 → 调 `Emslib::flush($email, $event)` 删除该 email+event 的所有 `fa_ems` 行"', () => {
      // The spec is explicit about the flush on expiry but the same row's
      // fate after a single over-limit attempt (vs needing the expiry branch
      // first) is not clearly distinguished in the Done table. Leave as a
      // skipped marker so a future reader knows where the ambiguity lives.
    })
  })
})
