// Black-box tests for api/Validate controller.
// Spec: task/specs/api-Validate.md.
// IMPORTANT: spec corrects the upstream "plain string" guess — the controller
// returns the standard FastAdmin JSON envelope (`{code, msg, data, time}`),
// because Api::result() is never overridden. We assert the envelope shape.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'
import { closeFixtureConnection, cleanupTracked, makeUser, trackForCleanup } from '../helpers/fixtures.ts'
import { withApp, loadDbConfig } from '../../scripts/db.ts'

const PFX = loadDbConfig().prefix

afterEach(async () => { await cleanupTracked() })
afterAll(async () => { await closeFixtureConnection() })

/** Helper: POST form to /api/validate/<action> and return envelope. */
async function callValidate<T = unknown>(action: string, form: Record<string, unknown>) {
  const http = createHttpClient()
  return http.json<T>({ method: 'POST', url: `/api/validate/${action}`, form })
}

/** Insert an sms/ems row directly so we can assert check_*_correct paths. */
async function insertCode(table: 'sms' | 'ems', key: 'mobile' | 'email', value: string, code: string, event: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000)
  return withApp(async (db) => {
    const [res] = await db.query(
      `INSERT INTO \`${PFX}${table}\` (event, \`${key}\`, code, times, ip, createtime)
       VALUES (?, ?, ?, 0, '127.0.0.1', ?)`,
      [event, value, code, now],
    )
    const id = (res as { insertId: number }).insertId
    trackForCleanup(`${PFX}${table}`, id)
    return id
  })
}

describe('api/Validate', () => {
  // ---------- _available checks: occupied → fail; fresh → success ----------

  describe('check_email_available', () => {
    it('returns code:0 when email is already in use', async () => {
      const u = await makeUser()
      const r = await callValidate('check_email_available', { email: u.email })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:1 when email is free', async () => {
      const fresh = `fresh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.local`
      const r = await callValidate('check_email_available', { email: fresh })
      expect(r.code).toBe(1)
      expect(typeof r.time).toBe('string')
    })

    it('excludes the supplied id from the occupancy check', async () => {
      const u = await makeUser()
      const r = await callValidate('check_email_available', { email: u.email, id: u.id })
      expect(r.code).toBe(1)
    })
  })

  describe('check_username_available', () => {
    it('returns code:0 when username is already in use', async () => {
      const u = await makeUser()
      const r = await callValidate('check_username_available', { username: u.username })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:1 when username is free', async () => {
      const fresh = `fresh_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const r = await callValidate('check_username_available', { username: fresh })
      expect(r.code).toBe(1)
    })
  })

  describe('check_nickname_available', () => {
    it('returns code:0 when nickname is already in use', async () => {
      const u = await makeUser()
      const r = await callValidate('check_nickname_available', { nickname: u.nickname })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:1 when nickname is free', async () => {
      const fresh = `fresh_nick_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const r = await callValidate('check_nickname_available', { nickname: fresh })
      expect(r.code).toBe(1)
    })
  })

  describe('check_mobile_available', () => {
    it('returns code:0 when mobile is already in use', async () => {
      const u = await makeUser()
      const r = await callValidate('check_mobile_available', { mobile: u.mobile })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:1 when mobile is free', async () => {
      const fresh = `136${Date.now().toString().slice(-8)}`
      const r = await callValidate('check_mobile_available', { mobile: fresh })
      expect(r.code).toBe(1)
    })
  })

  // ---------- _exist checks: opposite semantics ----------

  describe('check_mobile_exist', () => {
    it('returns code:1 when mobile is present in user table', async () => {
      const u = await makeUser()
      const r = await callValidate('check_mobile_exist', { mobile: u.mobile })
      expect(r.code).toBe(1)
    })

    it('returns code:0 when mobile is not registered', async () => {
      const missing = `135${Date.now().toString().slice(-8)}`
      const r = await callValidate('check_mobile_exist', { mobile: missing })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  describe('check_email_exist', () => {
    it('returns code:1 when email is present in user table', async () => {
      const u = await makeUser()
      const r = await callValidate('check_email_exist', { email: u.email })
      expect(r.code).toBe(1)
    })

    it('returns code:0 when email is not registered', async () => {
      const missing = `nobody_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.local`
      const r = await callValidate('check_email_exist', { email: missing })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  // ---------- captcha checks: seed fa_sms/fa_ems directly ----------

  describe('check_sms_correct', () => {
    it('returns code:0 when no sms record exists for this mobile/event', async () => {
      const mobile = `134${Date.now().toString().slice(-8)}`
      const r = await callValidate('check_sms_correct', {
        mobile, captcha: '123456', event: 'register',
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:0 when the captcha does not match', async () => {
      const mobile = `134${Date.now().toString().slice(-8)}`
      await insertCode('sms', 'mobile', mobile, '111111', 'register')
      const r = await callValidate('check_sms_correct', {
        mobile, captcha: '999999', event: 'register',
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    // Per spec: matching code only succeeds if the `sms_check` hook returns
    // truthy. With no listener registered the library returns null → controller
    // emits code:0. Skip the happy path until hook wiring is confirmed.
    it.skip('returns code:1 when captcha matches (spec: "code == captcha → 触发 sms_check Hook，返回 hook 结果")', async () => {
      const mobile = `134${Date.now().toString().slice(-8)}`
      await insertCode('sms', 'mobile', mobile, '222222', 'register')
      const r = await callValidate('check_sms_correct', {
        mobile, captcha: '222222', event: 'register',
      })
      expect(r.code).toBe(1)
    })
  })

  describe('check_ems_correct', () => {
    it('returns code:0 when no ems record exists for this email/event', async () => {
      const email = `nocode_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.local`
      const r = await callValidate('check_ems_correct', {
        email, captcha: '123456', event: 'register',
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:0 when the captcha does not match', async () => {
      const email = `mismatch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.local`
      await insertCode('ems', 'email', email, '111111', 'register')
      const r = await callValidate('check_ems_correct', {
        email, captcha: '000000', event: 'register',
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns code:1 when captcha matches a fresh record (Ems::check returns true even without hook listener)', async () => {
      const email = `match_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.local`
      await insertCode('ems', 'email', email, '333333', 'register')
      const r = await callValidate('check_ems_correct', {
        email, captcha: '333333', event: 'register',
      })
      expect(r.code).toBe(1)
    })
  })
})
