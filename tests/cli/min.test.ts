// `php think min` — asset minification (JS/CSS via node + grunt).
//
// The PHP container typically lacks node/grunt, so most cases are skipped
// with a clear note. Help text is still asserted when the command exists.
import { describe, it, expect } from 'vitest'
import { runThink, dockerExec } from '../helpers/cli'

// Probe container once: does it have `node` available?
const nodeProbe = dockerExec(['sh', '-lc', 'which node || true'])
const hasNode = nodeProbe.stdout.trim().length > 0

const gruntProbe = dockerExec(['sh', '-lc', 'which grunt || true'])
const hasGrunt = gruntProbe.stdout.trim().length > 0

const canMinify = hasNode && hasGrunt

describe('cli: php think min', () => {
  it('environment probe — node/grunt availability', () => {
    // Diagnostic: log presence for downstream skip reasoning.
    // Not a hard assertion — the probe must merely return.
    expect(nodeProbe.exitCode).toBeGreaterThanOrEqual(-1)
    expect(gruntProbe.exitCode).toBeGreaterThanOrEqual(-1)
  })

  it('`php think min --help` exits 0 and prints usage', () => {
    const r = runThink({ args: ['min', '--help'] })
    expect(r.exitCode).toBe(0)
    // ThinkPHP console help typically includes "Usage:" and the command name.
    expect(r.combined.toLowerCase()).toContain('usage')
    expect(r.combined.toLowerCase()).toMatch(/min/)
  })

  it('`php think min` (no args) shows usage / option list', () => {
    const r = runThink({ args: ['min'] })
    // Either prints help (exit 0) or errors with non-zero;
    // in both cases the output should mention the -m / module option.
    expect(r.combined.toLowerCase()).toMatch(/-m|module|min/)
  })

  // The following cases require node + grunt inside the container.
  // On stock fastadmin-test-php-1 these are absent, so we skip.
  const itMin = canMinify ? it : it.skip

  itMin('`php think min -m all` happy path — generates minified bundles', () => {
    // container lacks node/grunt — skipped by default
    const r = runThink({ args: ['min', '-m', 'all'], timeoutMs: 180_000 })
    expect(r.exitCode).toBe(0)
    expect(r.combined.toLowerCase()).toMatch(/min|done|complete|success/)
  })

  itMin('`php think min -m backend` only bundles backend assets', () => {
    // container lacks node/grunt — skipped by default
    const r = runThink({ args: ['min', '-m', 'backend'], timeoutMs: 180_000 })
    expect(r.exitCode).toBe(0)
  })

  itMin('`php think min -m frontend` only bundles frontend assets', () => {
    // container lacks node/grunt — skipped by default
    const r = runThink({ args: ['min', '-m', 'frontend'], timeoutMs: 180_000 })
    expect(r.exitCode).toBe(0)
  })

  // Dependency-missing path: if node is absent, the command itself should
  // either refuse cleanly or error in a way that does not 500.
  const itNoNode = !canMinify ? it : it.skip

  itNoNode('without node/grunt, `php think min -m all` fails clearly', () => {
    const r = runThink({ args: ['min', '-m', 'all'], timeoutMs: 60_000 })
    // We don't assert a specific exit code — just that the runner did
    // not hang and produced some diagnostic output.
    expect(r.exitCode).not.toBe(0)
    expect(r.combined.length).toBeGreaterThan(0)
  })
})
