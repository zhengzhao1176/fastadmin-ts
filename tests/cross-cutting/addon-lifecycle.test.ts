// Addon lifecycle — install / state / uninstall / config / upgrade.
//
// The full spec (see task/30-cross-cutting/07-addon-lifecycle.md) calls for
// an end-to-end install→state→config→upgrade→uninstall flow against a real
// sample-addon.zip. That requires:
//   1. a fixture zip at tests/fixtures/addons/sample-addon.zip, and
//   2. mocking the FastAdmin market API (api.fastadmin.net) for
//      install / upgrade / isbuy / authorization / valid / downloaded.
//
// Neither is wired up in this test environment, so external HTTP to
// api.fastadmin.net is unavailable — every market-touching action will
// fail-fast. Those cases are kept as `it.skip` with the missing-fixture /
// missing-mock reason inlined.
//
// What we CAN exercise black-box today:
//   - `index` HTML render (no outbound HTTP from the action itself; the
//     market list is fetched by the browser, not by the controller).
//   - `get_table_list` — pure DB lookup against MySQL information_schema,
//     restricted to `fa_*` tables (prefix + addon name).
//   - `uninstall` / `state` against a non-existent name — early validation
//     branch returns `code: 0` before any market call.
//   - `downloaded` shape — `it.skip` per spec (hits market API on cache miss).
import { afterAll, describe, expect, it } from 'vitest'
import { loginAsAdmin } from '../helpers/auth.ts'
import { dockerExec } from '../helpers/cli.ts'
import { closeFixtureConnection } from '../helpers/fixtures.ts'

afterAll(async () => {
  await closeFixtureConnection()
})

describe('GET /admin/addon/index', () => {
  it('renders the addon index HTML without an outbound market call', async () => {
    const http = await loginAsAdmin('super')
    const html = await http.html({ method: 'GET', url: '/admin/addon/index' })
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
    // assignconfig injects api_url / faversion into the page; the controller
    // itself does not call out to api.fastadmin.net for `index`.
    expect(html.toLowerCase()).toContain('<html')
  })
})

describe('POST /admin/addon/get_table_list', () => {
  it('returns a tables array (possibly empty) for a syntactically valid name', async () => {
    const http = await loginAsAdmin('super')
    // Use a name that almost certainly has no matching tables; the action
    // still succeeds (code=1) and returns `tables: []`.
    const r = await http.json<{ tables: string[] }>({
      method: 'POST',
      url: '/admin/addon/get_table_list',
      form: { name: 'nosuchaddon' },
    })
    expect(r.code).toBe(1)
    expect(Array.isArray(r.data?.tables)).toBe(true)
  })

  it('matches only fa_<name>-prefixed tables when the addon exists', async () => {
    // Pick an addon name that maps to real fa_* tables in this DB. We use
    // `user`, which the seed always provisions (fa_user, fa_user_*).
    const http = await loginAsAdmin('super')
    const r = await http.json<{ tables: string[] }>({
      method: 'POST',
      url: '/admin/addon/get_table_list',
      form: { name: 'user' },
    })
    expect(r.code).toBe(1)
    const tables = r.data?.tables ?? []
    expect(Array.isArray(tables)).toBe(true)
    // Cross-check against MySQL via docker — every returned name must
    // start with the prefix + addon name (per spec: filter rule).
    for (const t of tables) {
      expect(t.toLowerCase().startsWith('fa_user')).toBe(true)
    }
    // Sanity: if the seed has fa_user at all, the helper saw it.
    const ls = dockerExec(['sh', '-c', "mysql -h db -u root -proot_for_test fastadmin_test -N -e \"SHOW TABLES LIKE 'fa_user%'\" 2>/dev/null || true"])
    if (ls.exitCode === 0 && ls.stdout.includes('fa_user')) {
      expect(tables.length).toBeGreaterThan(0)
    }
  })

  it('rejects an invalid (non-alnum) name with code 0', async () => {
    const http = await loginAsAdmin('super')
    const r = await http.json({
      method: 'POST',
      url: '/admin/addon/get_table_list',
      form: { name: 'bad-name!' },
    })
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })
})

describe('POST /admin/addon/uninstall', () => {
  it('returns code 0 for a non-existent addon (early validation)', async () => {
    const http = await loginAsAdmin('super')
    const r = await http.json({
      method: 'POST',
      url: '/admin/addon/uninstall',
      form: { name: 'definitelynotinstalled', force: 0 },
    })
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })
})

describe('POST /admin/addon/state', () => {
  it('returns code 0 when enabling a non-existent addon', async () => {
    const http = await loginAsAdmin('super')
    const r = await http.json({
      method: 'POST',
      url: '/admin/addon/state',
      form: { name: 'definitelynotinstalled', action: 'enable' },
    })
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })

  it('returns code 0 when disabling a non-existent addon', async () => {
    const http = await loginAsAdmin('super')
    const r = await http.json({
      method: 'POST',
      url: '/admin/addon/state',
      form: { name: 'definitelynotinstalled', action: 'disable' },
    })
    expect(r.code).toBe(0)
    expect(r.msg.length).toBeGreaterThan(0)
  })
})

describe('market-API-dependent actions (skipped — see notes)', () => {
  // Per spec, these actions reach out to https://api.fastadmin.net via
  // Guzzle. The test env has no network egress to that host and no
  // intercepting proxy is configured, so the requests fail-fast inside
  // Service::download / Service::valid / Service::isBuy / Service::authorization.
  // We keep them as skipped placeholders so the lifecycle coverage gap is
  // visible in test output rather than silently absent.

  it.skip('GET /admin/addon/downloaded returns { total, rows } — requires fastadmin market mock not yet implemented', async () => {
    // Action returns *bare* JSON (no envelope) per spec admin-Addon.md.
    // On a cache miss it calls Service::addons → GET <api_url>/addon/index,
    // which 5xx's in this env. With a working mock the assertion would be:
    //   const r = await http.request<{ total: number; rows: unknown[] }>({ method: 'GET', url: '/admin/addon/downloaded' })
    //   expect(r.status).toBe(200)
    //   expect(typeof (r.body as any).total).toBe('number')
    //   expect(Array.isArray((r.body as any).rows)).toBe(true)
  })

  it.skip('POST /admin/addon/local installs from an uploaded zip — needs sample-addon.zip fixture and fastadmin market mock', async () => {
    // Spec requires tests/fixtures/addons/sample-addon.zip (info.ini +
    // Sample.php + install.sql + uninstall.sql) AND a mock of
    // POST <api_url>/addon/valid returning { code: 1 }.
  })

  it.skip('POST /admin/addon/install pulls from market — requires fastadmin market mock not yet implemented', async () => {
    // Service::download → GET https://api.fastadmin.net/addon/download is
    // not reachable from the test sandbox. Needs Guzzle handler stack
    // (or HTTP-level proxy) to return a fixture zip.
  })

  it.skip('POST /admin/addon/upgrade bumps version — requires fastadmin market mock + pre-installed addon', async () => {
    // Combined gap: needs the sample addon installed first AND a mock of
    // the market /addon/download endpoint serving a newer version zip.
  })

  it.skip('POST /admin/addon/isbuy proxies market response — requires fastadmin market mock not yet implemented', async () => {
    // Service::isBuy POSTs to <api_url>/addon/isbuy and returns the raw
    // response verbatim. Without a mock it raises a network error.
  })

  it.skip('POST /admin/addon/authorization writes .addonrc — requires fastadmin market mock not yet implemented', async () => {
    // Service::authorization POSTs to <api_url>/addon/authorization and
    // expects `{ code: 1, data: { addons: [...] } }` shape per spec.
  })

  it.skip('POST /admin/addon/testdata imports testdata.sql — needs sample-addon.zip fixture with testdata.sql', async () => {
    // No external HTTP, but the action requires an addon already on disk
    // with a non-empty testdata.sql. Blocked on the same fixture as `local`.
  })
})
