// Cross-cutting: i18n (multi-language) coverage.
//
// FastAdmin chooses request language via:
//   - query string ?lang=xx (highest)
//   - cookie think_var=xx
//   - default zh-cn
// Switch only takes effect if the requested code is in `allow_lang_list`
// (zh-cn, en); otherwise falls back to the default.
//
// We probe behaviour through a known bad-password error on /api/user/login
// (a stable user-visible string) and through /admin/ajax/lang which dumps
// the JS lang pack for a controller.
import { describe, it, expect } from 'vitest'
import { createHttpClient } from '../helpers/http.ts'

// A character class that matches CJK ideographs; if any code point falls in
// this range the message is "Chinese-looking" enough for our purposes.
const HAS_CJK = /[一-鿿]/
// ASCII-only check used to assert "no Chinese characters" without depending on
// any specific English wording (which would couple us to lang file copy).
const ASCII_ONLY = /^[\x20-\x7e]*$/

async function badLogin(
  http: ReturnType<typeof createHttpClient>,
  opts: { query?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<{ code: number; msg: string }> {
  // Use raw .request so we can attach arbitrary headers/query; the response
  // envelope shape is identical to what http.json would produce.
  const r = await http.request<unknown>({
    method: 'POST',
    url: '/api/user/login',
    form: { account: 'definitely_not_a_real_user_xyz', password: 'wrong-pass-123' },
    query: opts.query,
    headers: opts.headers,
    ajax: true,
  })
  if (typeof r.body === 'string') {
    throw new Error(`expected JSON envelope, got string: ${r.body.slice(0, 120)}`)
  }
  return { code: r.body.code, msg: r.body.msg }
}

describe('i18n language switching', () => {
  it('defaults to zh-cn — bad login msg contains Chinese characters', async () => {
    const http = createHttpClient()
    const { code, msg } = await badLogin(http)
    // code is whatever the controller returns for the failure; we only care
    // that an error fired AND the message is in Chinese.
    expect(code).not.toBe(1)
    expect(msg.length).toBeGreaterThan(0)
    expect(HAS_CJK.test(msg)).toBe(true)
  })

  // FastAdmin ships with `lang_switch_on=false` so cookie/query lang switching
  // is a no-op. To exercise these paths you'd need to flip the config or test
  // against a build that has it enabled.
  it.skip('switches to en via cookie think_var=en — same error msg is ASCII/English (skip: lang_switch_on=false)', async () => {
    const http = createHttpClient()
    const { code, msg } = await badLogin(http, {
      // FastAdmin's Lang::detect() reads cookie name from var_language (default
      // think_var); setting it before the request is enough.
      headers: { Cookie: 'think_var=en' },
    })
    expect(code).not.toBe(1)
    expect(msg.length).toBeGreaterThan(0)
    // English lang pack has no CJK; if the message stays Chinese the switch
    // silently failed (key missing or middleware order wrong).
    expect(HAS_CJK.test(msg)).toBe(false)
    expect(ASCII_ONLY.test(msg)).toBe(true)
  })

  it.skip('switches to en via query ?lang=en — same error msg is ASCII/English (skip: lang_switch_on=false)', async () => {
    const http = createHttpClient()
    const { code, msg } = await badLogin(http, { query: { lang: 'en' } })
    expect(code).not.toBe(1)
    expect(msg.length).toBeGreaterThan(0)
    expect(HAS_CJK.test(msg)).toBe(false)
    expect(ASCII_ONLY.test(msg)).toBe(true)
  })

  it.skip('/admin/ajax/lang?lang=en returns the en JS lang pack (skip: lang_switch_on=false; /admin/ajax/lang ignores lang query)', async () => {
    const http = createHttpClient()
    // This endpoint is in $noNeedLogin for admin/Ajax so it's reachable
    // unauthenticated. Response is `var Lang = {...};` JSON-ish JS.
    const r = await http.request<unknown>({
      method: 'GET',
      url: '/admin/ajax/lang',
      query: { lang: 'en', controllername: 'index' },
      // Lang endpoint returns text/javascript, not JSON envelope — keep ajax
      // off so FastAdmin doesn't try to wrap it.
      ajax: false,
    })
    expect(r.status).toBe(200)
    expect(typeof r.body).toBe('string')
    const body = r.body as string
    // Two signals together rule out an accidental zh-cn fallback:
    //   1. no CJK characters anywhere
    //   2. the lang pack actually contains something (not an empty object)
    expect(HAS_CJK.test(body)).toBe(false)
    expect(body.length).toBeGreaterThan(10)
  })

  it('lang=fr falls back to zh-cn (not in allow_lang_list)', async () => {
    const http = createHttpClient()
    const { code, msg } = await badLogin(http, { query: { lang: 'fr' } })
    expect(code).not.toBe(1)
    expect(msg.length).toBeGreaterThan(0)
    // fr is not allowed → should silently use the default (zh-cn). If somehow
    // the request switched to en, this assertion would fail and tell us the
    // allow_lang_list check is bypassed.
    expect(HAS_CJK.test(msg)).toBe(true)
  })

  it.skip('missing translation key — en falls back to the key/default', () => {
    // Skipped intentionally: locating a key that lives only in zh-cn lang
    // files and is reachable via a stable HTTP path requires diffing two
    // language packs and finding a controller path that triggers it. That
    // mapping is brittle (changes whenever lang files are updated) so the
    // value of asserting it from black-box HTTP is low compared to the
    // maintenance cost. Leaving as a placeholder so future contributors can
    // implement it if a stable case is found.
  })
})
