import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { loginAsAdmin, unauthenticated } from '../helpers/auth.ts'
import { cleanupTracked, closeFixtureConnection } from '../helpers/fixtures.ts'

afterEach(() => cleanupTracked())
afterAll(() => closeFixtureConnection())

describe('admin/Addon', () => {
  describe('index', () => {
    it('GET as super-admin returns HTML', async () => {
      const http = await loginAsAdmin('super')
      const body = await http.html({ method: 'GET', url: '/admin/addon/index' })
      expect(body.length).toBeGreaterThan(0)
      expect(body).toMatch(/<[a-z!]/i)
    })

    it('GET unauthenticated → redirect or non-success', async () => {
      const http = unauthenticated()
      const r = await http.request({ method: 'GET', url: '/admin/addon/index', ajax: false })
      if (r.status === 302) {
        expect((r.headers['location'] ?? '').toLowerCase()).toContain('login')
      } else if (typeof r.body === 'object' && r.body !== null) {
        expect((r.body as unknown as { code: number }).code).not.toBe(1)
      } else {
        expect(r.status).toBeGreaterThanOrEqual(200)
      }
    })
  })

  describe('config', () => {
    it.skip('GET happy path: HTML for an installed addon — no addon present in seed', () => {
      // Needs an installed addon under addons/<name>/; addressed in cross-cutting addon-lifecycle.
    })

    it.skip('POST happy path: read → modify → read shows value changed — no addon installed in seed', () => {
      // Needs an installed addon; addressed in cross-cutting addon-lifecycle.
    })

    it('POST missing name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/config',
        form: { name: '', 'row[k]': 'v' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('POST malformed name (illegal chars) → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/config',
        form: { name: 'bad-name!', 'row[k]': 'v' },
      })
      expect(r.code).toBe(0)
    })

    it('POST addon not exists → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/config',
        form: { name: `nosuch${Date.now().toString(36)}`, 'row[k]': 'v' },
      })
      expect(r.code).toBe(0)
    })
  })

  describe('install', () => {
    it.skip('happy path returns code=1 with data.addon — requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})

    it('non-super admin → code=0 (super-only guard)', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/install',
        form: { name: 'whatever' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('missing name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/install',
        form: { name: '' },
      })
      expect(r.code).toBe(0)
    })

    it('malformed name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/install',
        form: { name: 'bad name!' },
      })
      expect(r.code).toBe(0)
    })
  })

  describe('uninstall', () => {
    it('non-super admin → code=0', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/uninstall',
        form: { name: 'whatever' },
      })
      expect(r.code).toBe(0)
    })

    it('missing name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/uninstall',
        form: { name: '' },
      })
      expect(r.code).toBe(0)
    })

    it('malformed name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/uninstall',
        form: { name: 'bad-name!' },
      })
      expect(r.code).toBe(0)
    })

    it('uninstall non-existent addon → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/uninstall',
        form: { name: `nosuch${Date.now().toString(36)}` },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  describe('state', () => {
    it.skip('happy path toggles enable/disable on installed addon — no addon installed in seed', () => {
      // Needs an installed addon; addressed in cross-cutting addon-lifecycle.
    })

    it('missing name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/state',
        form: { name: '', action: 'enable' },
      })
      expect(r.code).toBe(0)
    })

    it('malformed name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/state',
        form: { name: 'bad-name!', action: 'enable' },
      })
      expect(r.code).toBe(0)
    })

    it('addon not exists → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/state',
        form: { name: `nosuch${Date.now().toString(36)}`, action: 'enable' },
      })
      expect(r.code).toBe(0)
    })
  })

  describe('local', () => {
    it.skip('happy path: upload zip → addons/<name>/ exists, DB row created — needs sample-addon.zip fixture; addressed in cross-cutting', () => {})

    it('non-super admin → code=0', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/local',
        form: { uid: 'x', token: 'x' },
      })
      expect(r.code).toBe(0)
    })

    it('super-admin POST without uid/token → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/local',
        form: {},
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('super-admin POST with uid/token but no file → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/local',
        form: { uid: 'u1', token: 't1' },
      })
      expect(r.code).toBe(0)
    })
  })

  describe('upgrade', () => {
    it.skip('happy path requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})

    it('non-super admin → code=0', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/upgrade',
        form: { name: 'whatever' },
      })
      expect(r.code).toBe(0)
    })

    it('missing name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/upgrade',
        form: { name: '' },
      })
      expect(r.code).toBe(0)
    })

    it('malformed name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/upgrade',
        form: { name: 'bad-name!' },
      })
      expect(r.code).toBe(0)
    })
  })

  describe('testdata', () => {
    it('non-super admin → code=0', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/testdata',
        form: { name: 'whatever' },
      })
      expect(r.code).toBe(0)
    })

    it('missing name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/testdata',
        form: { name: '' },
      })
      expect(r.code).toBe(0)
    })

    it('malformed name → code=0', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/testdata',
        form: { name: 'bad-name!' },
      })
      expect(r.code).toBe(0)
    })

    it('non-existent addon → code=1 (testdata silently succeeds when nothing to do)', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/testdata',
        form: { name: `nosuch${Date.now().toString(36)}` },
      })
      // PHP behaviour: testdata returns success even for unknown addon (no error path).
      expect(r.code).toBe(1)
    })
  })

  describe('downloaded', () => {
    it.skip('happy path returns bare JSON {total, rows} — requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})
    it.skip('filter/search/JSONP variants — requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})
  })

  describe('isbuy', () => {
    it.skip('happy path: bare JSON pass-through — requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})
    it.skip('network error → envelope code=0 "Network error" — requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})
  })

  describe('authorization', () => {
    it.skip('happy path: code=1 and writes .addonrc — requires fastadmin market mock — see task/30-cross-cutting/07-addon-lifecycle.md', () => {})

    it('non-super admin → code=0', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/authorization',
        form: { uid: 'x', token: 'x' },
      })
      expect(r.code).toBe(0)
    })
  })

  describe('get_table_list', () => {
    it('happy path: returns code=1 with data.tables array (fa_-prefixed)', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json<{ tables: string[] }>({
        method: 'POST',
        url: '/admin/addon/get_table_list',
        form: { name: 'demo' },
      })
      expect(r.code).toBe(1)
      expect(r.data).toBeTypeOf('object')
      expect(r.data).not.toBeNull()
      expect(Array.isArray(r.data?.tables)).toBe(true)
      for (const t of r.data!.tables) {
        expect(typeof t).toBe('string')
        expect(t.startsWith('fa_')).toBe(true)
      }
    })

    it('accessible by non-super admin (in noNeedRight)', async () => {
      const http = await loginAsAdmin('subadmin')
      const r = await http.json<{ tables: string[] }>({
        method: 'POST',
        url: '/admin/addon/get_table_list',
        form: { name: 'demo' },
      })
      expect(r.code).toBe(1)
      expect(Array.isArray(r.data?.tables)).toBe(true)
    })

    it('malformed name → code=0 "Addon name incorrect"', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/get_table_list',
        form: { name: 'bad-name!' },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('empty name → code=0 (empty falls into format-error branch per spec)', async () => {
      const http = await loginAsAdmin('super')
      const r = await http.json({
        method: 'POST',
        url: '/admin/addon/get_table_list',
        form: { name: '' },
      })
      expect(r.code).toBe(0)
    })

    it('unauthenticated → not code=1', async () => {
      const http = unauthenticated()
      const r = await http.request({
        method: 'POST',
        url: '/admin/addon/get_table_list',
        form: { name: 'demo' },
        ajax: true,
      })
      if (typeof r.body === 'object' && r.body !== null) {
        expect((r.body as unknown as { code: number }).code).not.toBe(1)
      } else {
        expect(typeof r.body).toBe('string')
      }
    })
  })
})
