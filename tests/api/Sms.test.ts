// Tests for api/Sms controller — covers `send` validation branches and
// `check` (success / expired / wrong-code). The real send path requires the
// `sms_send` hook to be mocked (see cross-cutting tasks), so the happy-path
// network test for `send` is skipped here.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { createHttpClient, type Envelope } from '../helpers/http.ts'
import { closeFixtureConnection, cleanupTracked, trackForCleanup } from '../helpers/fixtures.ts'
import { withApp } from '../../scripts/db.ts'
import { loadDbConfig } from '../../scripts/db.ts'

const PFX = loadDbConfig().prefix

// ---- helpers ----
function randomMobile(): string {
  // 11 digits starting with 1 — matches the controller regex /^1\d{10}$/.
  const tail = Math.floor(Math.random() * 1e10).toString().padStart(10, '0')
  return `1${tail}`
}

interface SmsRow {
  id: number
  event: string
  mobile: string
  code: string
  ip: string
  createtime: number
  times: number
}

async function insertSms(opts: {
  mobile: string
  event: string
  code: string
  createtime?: number
  times?: number
}): Promise<SmsRow> {
  return withApp(async (db) => {
    const ct = opts.createtime ?? Math.floor(Date.now() / 1000)
    const [res] = await db.query<ResultSetHeader>(
      `INSERT INTO \`${PFX}sms\` (event, mobile, code, ip, createtime, times)
       VALUES (?, ?, ?, '127.0.0.1', ?, ?)`,
      [opts.event, opts.mobile, opts.code, ct, opts.times ?? 0],
    )
    trackForCleanup(`${PFX}sms`, res.insertId)
    return {
      id: res.insertId,
      event: opts.event,
      mobile: opts.mobile,
      code: opts.code,
      ip: '127.0.0.1',
      createtime: ct,
      times: opts.times ?? 0,
    }
  })
}

async function readSmsRows(mobile: string, event: string): Promise<SmsRow[]> {
  return withApp(async (db) => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, event, mobile, code, ip, createtime, times
         FROM \`${PFX}sms\` WHERE mobile = ? AND event = ? ORDER BY id DESC`,
      [mobile, event],
    )
    return rows as unknown as SmsRow[]
  })
}

describe('api/Sms', () => {
  afterEach(async () => {
    await cleanupTracked()
  })

  afterAll(async () => {
    await closeFixtureConnection()
  })

  // -----------------------------------------------------------------
  // send
  // -----------------------------------------------------------------
  describe('send', () => {
    it.skip('happy path: returns code=1 and writes fa_sms row — needs sms_send hook mock — addressed in cross-cutting', async () => {
      // Spec: "测试需 mock `sms_send` 钩子" / driver lives in a plugin not in scope.
      // Without that mock, send returns "请在后台插件管理安装短信验证插件",
      // so happy-path real network exercise is deferred.
    })

    it('rejects empty mobile with code=0 (手机号不正确)', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/send',
        form: { mobile: '', event: 'register' },
      })
      expect(r.code).toBe(0)
      expect(typeof r.msg).toBe('string')
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('rejects mobile with wrong format (10 digits, no leading 1)', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/send',
        form: { mobile: '0123456789', event: 'register' },
      })
      expect(r.code).toBe(0)
    })

    it('rejects mobile with non-digit characters', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/send',
        form: { mobile: '1abcdefghij', event: 'register' },
      })
      expect(r.code).toBe(0)
    })

    it('rejects mobile that is too short (10 chars)', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/send',
        form: { mobile: '1380013800', event: 'register' },
      })
      expect(r.code).toBe(0)
    })

    it('rejects mobile that is too long (12 chars)', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/send',
        form: { mobile: '138001380001', event: 'register' },
      })
      expect(r.code).toBe(0)
    })

    it('treats missing mobile param as bad mobile (code=0)', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/send',
        form: { event: 'register' },
      })
      expect(r.code).toBe(0)
    })

    it.skip('rejects unknown event value — Unclear from code: "其它任意非空字符串也会被透传给 Smslib（Unclear from code: 是否在更上游有白名单）"', async () => {
      // Per spec, behaviour with arbitrary non-empty event strings is undefined
      // in the current source — they likely fall through to the hook layer.
    })
  })

  // -----------------------------------------------------------------
  // check
  // -----------------------------------------------------------------
  describe('check', () => {
    it('rejects empty mobile with code=0', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile: '', event: 'register', captcha: '1234' },
      })
      expect(r.code).toBe(0)
    })

    it('rejects bad mobile format with code=0', async () => {
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile: 'abcdefghijk', event: 'register', captcha: '1234' },
      })
      expect(r.code).toBe(0)
    })

    it('returns code=1 when the stored code matches and is fresh', async () => {
      const mobile = randomMobile()
      const code = '654321'
      const row = await insertSms({ mobile, event: 'mobilelogin', code })

      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile, event: 'mobilelogin', captcha: code },
      })
      expect(r.code).toBe(1)
      expect(typeof r.time).toBe('string')
      expect(parseInt(r.time, 10)).toBeGreaterThan(0)
      // Mark for cleanup in case the controller mutated the row id.
      trackForCleanup(`${PFX}sms`, row.id)
    })

    it('returns code=0 when the captcha is wrong and bumps times', async () => {
      const mobile = randomMobile()
      const stored = '111222'
      const row = await insertSms({ mobile, event: 'mobilelogin', code: stored })

      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile, event: 'mobilelogin', captcha: '999999' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)

      // Side-effect: times is incremented on a wrong-code attempt.
      const after = await readSmsRows(mobile, 'mobilelogin')
      expect(after.length).toBe(1)
      expect(after[0]!.id).toBe(row.id)
      expect(after[0]!.times).toBeGreaterThanOrEqual(1)
    })

    it('returns code=0 when the stored code has expired (>120s old) and flushes the row', async () => {
      const mobile = randomMobile()
      const code = '424242'
      const stale = Math.floor(Date.now() / 1000) - 200 // > 120s ago
      await insertSms({ mobile, event: 'mobilelogin', code, createtime: stale })

      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile, event: 'mobilelogin', captcha: code },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)

      // Side-effect: Smslib::flush deletes the expired record.
      const after = await readSmsRows(mobile, 'mobilelogin')
      expect(after.length).toBe(0)
    })

    it('returns code=0 when there is no fa_sms row at all', async () => {
      const mobile = randomMobile()
      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile, event: 'mobilelogin', captcha: '000000' },
      })
      expect(r.code).toBe(0)
    })

    it('event=register: bad-captcha branch still rejects with code=0 (unregistered mobile)', async () => {
      const mobile = randomMobile()
      const stored = '321321'
      await insertSms({ mobile, event: 'register', code: stored })

      const http = createHttpClient()
      const r = await http.json<unknown>({
        method: 'POST',
        url: '/api/sms/check',
        form: { mobile, event: 'register', captcha: 'wrong0' },
      })
      expect(r.code).toBe(0)
    })

    it.skip('success on event=register hits sms_check hook — Unclear from code: "若钩子未注册，`Hook::listen` 的返回是否一律 true（依赖框架默认）"', async () => {
      // Per spec, the framework default for an unregistered hook is unclear;
      // covered in cross-cutting hook tests.
    })
  })
})

// Touch the Envelope import so the type is exercised under noUnusedLocals.
export type _EnvelopeProbe = Envelope<unknown>
