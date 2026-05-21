// `php think addon` — addon scaffold / lifecycle CLI.
//
// The command exposes (from application/admin/command/Addon.php):
//   --action / -c   create | enable | disable | uninstall | refresh |
//                   install | upgrade | package | move      (default: create)
//   --name   / -a   addon directory name (required for everything but `refresh`)
//   --force  / -f   override / skip conflict prompt
//
// IMPORTANT: the short option `-a` belongs to **--name** (not --action!) and
// the short option `-c` belongs to **--action**.  We use long-form flags in
// these tests to avoid any short-flag confusion.
//
// Side effects exercised here are all local-filesystem (and a refresh of
// public/assets/js/addons.js by Service::refresh). The `create` action does
// not write any `fa_addon` DB row in the base schema — there is no such table
// — but we still try a defensive DELETE in cleanup in case a downstream
// install.sql or seed has provisioned one.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import {
  containerDirExists,
  containerFileExists,
  containerRm,
  dockerExec,
  runThink,
} from '../helpers/cli.ts'
import { closeFixtureConnection } from '../helpers/fixtures.ts'
import { connectAsApp, loadDbConfig } from '../../scripts/db.ts'

const cfg = loadDbConfig()
const ADDON_BASE = '/app/addons'
const RUNTIME_ADDON_DIR = '/app/runtime/addons'

// Names created during the run that need post-test cleanup. The afterEach
// hook drains this between cases; afterAll catches anything left behind.
const createdNames = new Set<string>()

/** Lowercase-letter-only suffix so `package` (which enforces `/^[a-z]+$/i`) accepts the name. */
function uniqueAddonName(prefix = 'taddon'): string {
  const bytes = crypto.randomBytes(4).toString('hex') // 8 hex chars
  // strip digits — package validation rejects names with non-letters
  const letters = bytes.replace(/[0-9]/g, '') || 'aaaa'
  // pad to at least 4 letters
  const tail = (letters + 'aaaa').slice(0, 6)
  return `${prefix}${tail}`
}

/**
 * Best-effort cleanup of any `fa_addon` row created by the lifecycle.
 * The base schema does not include `fa_addon`, so a missing-table error is
 * silently swallowed; if a real `fa_addon` exists (e.g. installed via an
 * install.sql), the row keyed by `name` is removed.
 */
async function cleanupAddonDbRow(name: string): Promise<void> {
  try {
    const conn = await connectAsApp(cfg)
    try {
      await conn.query(`DELETE FROM \`${cfg.prefix}addon\` WHERE name = ?`, [name])
    } catch {
      // table absent / permission denied → ignore
    } finally {
      await conn.end()
    }
  } catch {
    // db unreachable → ignore (CLI tests still ran)
  }
}

async function cleanupOne(name: string): Promise<void> {
  containerRm(`${ADDON_BASE}/${name}`)
  // Drop any zip artefacts produced by `package`.
  dockerExec(['sh', '-lc', `rm -f ${RUNTIME_ADDON_DIR}/${name}-*.zip || true`])
  await cleanupAddonDbRow(name)
  createdNames.delete(name)
}

afterEach(async () => {
  for (const name of Array.from(createdNames)) {
    await cleanupOne(name)
  }
})

afterAll(async () => {
  // Catch-all in case a case died before reaching afterEach bookkeeping.
  for (const name of Array.from(createdNames)) {
    await cleanupOne(name)
  }
  await closeFixtureConnection()
})

describe('cli: php think addon', () => {
  it('`--help` prints usage and exits 0', () => {
    const r = runThink({ args: ['addon', '--help'] })
    expect(r.exitCode).toBe(0)
    expect(r.combined.toLowerCase()).toContain('usage')
    // Description text registered in configure().
    expect(r.combined.toLowerCase()).toMatch(/addon manager|addon/)
  })

  it('`--action=create` scaffolds /app/addons/<name>/', () => {
    const name = uniqueAddonName()
    createdNames.add(name)

    const r = runThink({ args: ['addon', '--action', 'create', '--name', name] })
    expect(r.exitCode, r.combined).toBe(0)
    expect(r.combined.toLowerCase()).toMatch(/create.*succ|success/)
    expect(containerDirExists(`${ADDON_BASE}/${name}`)).toBe(true)
    expect(containerDirExists(`${ADDON_BASE}/${name}/controller`)).toBe(true)
    expect(containerFileExists(`${ADDON_BASE}/${name}/info.ini`)).toBe(true)
  })

  it('`--action=refresh` refreshes plugin caches and exits 0', () => {
    const r = runThink({ args: ['addon', '--action', 'refresh'] })
    expect(r.exitCode, r.combined).toBe(0)
    expect(r.combined.toLowerCase()).toMatch(/refresh.*succ|success/)
    // Service::refresh re-writes public/assets/js/addons.js.
    expect(containerFileExists('/app/public/assets/js/addons.js')).toBe(true)
  })

  it('`--action=package` produces a zip in runtime/addons/', () => {
    const name = uniqueAddonName()
    createdNames.add(name)

    const create = runThink({ args: ['addon', '--action', 'create', '--name', name] })
    expect(create.exitCode, create.combined).toBe(0)

    const pkg = runThink({ args: ['addon', '--action', 'package', '--name', name] })
    expect(pkg.exitCode, pkg.combined).toBe(0)
    expect(pkg.combined.toLowerCase()).toMatch(/package.*succ|success/)

    // Default version from the stub is 1.0.0 → zip is <name>-1.0.0.zip.
    const zipPath = `${RUNTIME_ADDON_DIR}/${name}-1.0.0.zip`
    expect(containerFileExists(zipPath)).toBe(true)
  })

  it('`--action=disable` then `--action=enable` toggle info.ini state without error', () => {
    const name = uniqueAddonName()
    createdNames.add(name)

    const create = runThink({ args: ['addon', '--action', 'create', '--name', name] })
    expect(create.exitCode, create.combined).toBe(0)

    // Stub `info.ini` ships with state=1; disable should drop it to 0.
    const disable = runThink({
      args: ['addon', '--action', 'disable', '--name', name, '--force', 'true'],
    })
    expect(disable.exitCode, disable.combined).toBe(0)
    expect(disable.combined.toLowerCase()).toMatch(/disable.*succ|success/)

    const iniAfterDisable = dockerExec(['cat', `${ADDON_BASE}/${name}/info.ini`])
    expect(iniAfterDisable.exitCode).toBe(0)
    expect(iniAfterDisable.stdout).toMatch(/state\s*=\s*0/)

    const enable = runThink({
      args: ['addon', '--action', 'enable', '--name', name, '--force', 'true'],
    })
    expect(enable.exitCode, enable.combined).toBe(0)
    expect(enable.combined.toLowerCase()).toMatch(/enable.*succ|success/)

    const iniAfterEnable = dockerExec(['cat', `${ADDON_BASE}/${name}/info.ini`])
    expect(iniAfterEnable.exitCode).toBe(0)
    expect(iniAfterEnable.stdout).toMatch(/state\s*=\s*1/)
  })

  it('`--action=enable` on an unknown addon exits non-zero / reports an error', () => {
    const missing = `nosuch_${crypto.randomBytes(4).toString('hex')}`
    const r = runThink({
      args: ['addon', '--action', 'enable', '--name', missing, '--force', 'true'],
    })
    // The command throws \think\Exception which the console maps to a
    // non-zero exit. Some thinkphp builds still write the trace to stdout
    // with code 1; we accept either non-zero exit OR a stderr message.
    const failed = r.exitCode !== 0 || r.stderr.length > 0 || /not exist|error|exception/i.test(r.combined)
    expect(failed, `unexpected success: ${r.combined}`).toBe(true)
    expect(containerDirExists(`${ADDON_BASE}/${missing}`)).toBe(false)
  })
})
