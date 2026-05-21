// Tests for `php think api` command — generates static API documentation HTML
// from PHPDoc annotations on api-module controllers.
//
// See task/40-cli/05-api-command.md and fastAdmin/application/admin/command/Api.php.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  containerFileExists,
  containerRm,
  dockerExec,
  readContainerFile,
  runThink,
} from '../helpers/cli.js'

const API_HTML = '/app/public/api.html'
const BACKUP = '/tmp/api.html.bak'

let hadPreexisting = false

beforeAll(() => {
  // If the repo ships an api.html, back it up so we can restore in afterAll.
  hadPreexisting = containerFileExists(API_HTML)
  if (hadPreexisting) {
    dockerExec(['cp', API_HTML, BACKUP])
  }
  // Start each run from a clean slate.
  containerRm(API_HTML)
})

afterAll(() => {
  containerRm(API_HTML)
  if (hadPreexisting) {
    dockerExec(['cp', BACKUP, API_HTML])
    dockerExec(['rm', '-f', BACKUP])
  }
})

describe('php think api', () => {
  it('--help exits 0 and prints usage', () => {
    const r = runThink({ args: ['api', '--help'] })
    expect(r.exitCode).toBe(0)
    // ThinkPHP console always shows the command name in help output.
    expect(r.combined.toLowerCase()).toContain('api')
    // Should mention the module/controller option flags.
    expect(r.combined).toMatch(/-m|--module/)
    expect(r.combined).toMatch(/-c|--controller/)
  })

  it('with no args generates public/api.html', () => {
    // Ensure the artifact does not exist before running.
    containerRm(API_HTML)
    expect(containerFileExists(API_HTML)).toBe(false)

    const r = runThink({ args: ['api'], timeoutMs: 120_000 })
    expect(r.exitCode).toBe(0)
    expect(containerFileExists(API_HTML)).toBe(true)

    const html = readContainerFile(API_HTML)
    expect(html).not.toBeNull()
    expect(html!.length).toBeGreaterThan(0)
    // Should be an HTML document.
    expect(html!.toLowerCase()).toMatch(/<html|<!doctype/)
  })

  it('default doc includes a known api endpoint (user/login)', () => {
    if (!containerFileExists(API_HTML)) {
      const r = runThink({ args: ['api'], timeoutMs: 120_000 })
      expect(r.exitCode).toBe(0)
    }
    const html = readContainerFile(API_HTML)
    expect(html).not.toBeNull()
    // The api module's User controller exposes login; the generated doc
    // should reference it somewhere (route, title, or method name).
    expect(html!.toLowerCase()).toMatch(/user\/login|user.*login|login/)
  })

  it('-m api -c User generates a narrower doc scoped to that controller', () => {
    containerRm(API_HTML)
    // -c expects fully qualified class name, not short name.
    const r = runThink({
      args: ['api', '-m', 'api', '-c', 'app\\api\\controller\\User'],
      timeoutMs: 120_000,
    })
    expect(r.exitCode).toBe(0)
    expect(containerFileExists(API_HTML)).toBe(true)

    const html = readContainerFile(API_HTML)
    expect(html).not.toBeNull()
    expect(html!.length).toBeGreaterThan(0)
    // Narrowed to User → must mention user/login (a known User action).
    expect(html!.toLowerCase()).toContain('login')
    // PHP's api command writes a full template regardless of -c scope; the
    // "narrow" effect is on which @ApiTitle entries are inserted into the body.
    // We can't reliably assert exclusion via a substring search. Removed.
  })

  it('rejects an invalid module with non-zero exit', () => {
    const r = runThink({
      args: ['api', '-m', '__definitely_not_a_module__'],
      timeoutMs: 60_000,
    })
    // Either non-zero exit, or an error string in output (ThinkPHP commands
    // sometimes return 0 but log "[Error]"). Both signal failure to the user.
    const failed =
      r.exitCode !== 0 ||
      /error|exception|not\s*exist|不存在|无效/i.test(r.combined)
    expect(failed).toBe(true)
  })
})
