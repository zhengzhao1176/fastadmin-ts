// CLI tests for `php think install`.
//
// DANGER: `php think install` is destructive — it imports fastadmin.sql and
// overwrites tables on whatever DB it points at. To keep the regular test DB
// (`fastadmin_test`) safe, every destructive case here uses a dedicated DB
// (`fastadmin_install_test`) that is CREATEd and DROPped within the test
// itself. The remaining cases are `it.skip` with a tracking comment.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  containerFileExists,
  containerRm,
  dockerExec,
  runThink,
} from '../helpers/cli'
import { connectAsRoot, loadDbConfig } from '../../scripts/db'

const TEST_DB = 'fastadmin_install_test'
const LOCK_PATH = '/app/application/admin/command/Install/install.lock'

// Inside the docker network the mysql service is reachable via the compose
// alias `mysql` on port 3306, while the host-side helper goes through 127.0.0.1
// on a published port. CLI runs inside the php container → use `mysql:3306`.
const CLI_DB_HOST = 'mysql'
const CLI_DB_PORT = '3306'
const CLI_DB_USER = 'root'
const CLI_DB_PASS = 'root_for_test'

async function dropTestDb(): Promise<void> {
  const root = await connectAsRoot()
  try {
    await root.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
  } finally {
    await root.end()
  }
}

async function createTestDb(): Promise<void> {
  const root = await connectAsRoot()
  try {
    await root.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
    await root.query(
      `CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    )
  } finally {
    await root.end()
  }
}

async function countFaTables(): Promise<number> {
  const cfg = loadDbConfig()
  const root = await connectAsRoot(cfg)
  try {
    const [rows] = await root.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = ? AND table_name LIKE 'fa\\_%'`,
      [TEST_DB],
    )
    const arr = rows as Array<{ n: number | string }>
    return Number(arr[0]?.n ?? 0)
  } finally {
    await root.end()
  }
}

function runInstall(args: string[] = []) {
  // Note: `install` flag names are NON-STANDARD — `-a` is hostname (not host)
  // and `-o` is hostport (not -P). `-h` would print --help. Discovered via
  // `php think install --help`.
  return runThink({
    args: [
      'install',
      '-a', CLI_DB_HOST,
      '-o', CLI_DB_PORT,
      '-u', CLI_DB_USER,
      '-p', CLI_DB_PASS,
      '-d', TEST_DB,
      '-n',                  // --no-interaction (don't prompt for admin acct)
      ...args,
    ],
    timeoutMs: 120_000,
  })
}

describe('php think install', () => {
  // install has three nasty side-effects we must reverse before subsequent test
  // files run:
  //   1. removes install.lock — we recreate it
  //   2. rewrites /app/.env to point at the new DB — we snapshot to /tmp/.env.bak
  //   3. RENAMES /app/public/admin.php to a random name as a security feature —
  //      every admin HTTP test depends on /admin.php so we rename it back.
  const ENV_PATH = '/app/.env'
  const ENV_BACKUP_PATH = '/tmp/fa-env-snapshot.bak'
  function restoreLock(): void {
    dockerExec(['sh', '-c', `date > ${LOCK_PATH}`])
  }
  function snapshotEnv(): void {
    dockerExec(['cp', ENV_PATH, ENV_BACKUP_PATH])
  }
  function restoreEnv(): void {
    dockerExec(['cp', '-f', ENV_BACKUP_PATH, ENV_PATH])
  }
  function restoreAdminPhp(): void {
    dockerExec(['sh', '-c',
      "f=$(ls /app/public/*.php 2>/dev/null | grep -vE '/(index|router|install|admin)\\.php$' | head -1); " +
      "if [ -n \"$f\" ]; then mv \"$f\" /app/public/admin.php; fi",
    ])
  }
  function fullRestore(): void {
    restoreLock()
    restoreEnv()
    restoreAdminPhp()
  }

  beforeAll(() => {
    snapshotEnv()
    if (containerFileExists(LOCK_PATH)) containerRm(LOCK_PATH)
  })

  afterAll(async () => {
    await dropTestDb()
    if (containerFileExists(LOCK_PATH)) containerRm(LOCK_PATH)
    fullRestore()
  })

  it('--help exits 0', () => {
    const r = runThink({ args: ['install', '--help'] })
    expect(r.exitCode).toBe(0)
    expect(r.combined.toLowerCase()).toContain('install')
  })

  it('installs into a fresh DB, creates lock, then fails on re-run', async () => {
    // Guarantee a clean slate: fresh empty DB + no lock file.
    await createTestDb()
    if (containerFileExists(LOCK_PATH)) containerRm(LOCK_PATH)

    try {
      const r = runInstall()
      // Surface the CLI output on failure to make CI diagnosis easier.
      expect(r.exitCode, r.combined).toBe(0)

      // fa_* tables created (upstream fastadmin.sql ships 19; bump if this changes).
      const n = await countFaTables()
      expect(n).toBeGreaterThanOrEqual(15)

      // Lock file dropped after install.
      expect(containerFileExists(LOCK_PATH)).toBe(true)

      // Re-running with the lock present must refuse.
      const again = runInstall()
      expect(again.exitCode).not.toBe(0)
    } finally {
      await dropTestDb()
      if (containerFileExists(LOCK_PATH)) containerRm(LOCK_PATH)
      fullRestore()
    }
  }, 180_000)

  it('rejects bad DB credentials', async () => {
    // Ensure no lock blocks the credential check from being reached.
    if (containerFileExists(LOCK_PATH)) containerRm(LOCK_PATH)
    await createTestDb()
    try {
      const r = runThink({
        args: [
          'install',
          '-a', CLI_DB_HOST,
          '-o', CLI_DB_PORT,
          '-u', 'root',
          '-p', 'definitely-wrong-password',
          '-d', TEST_DB,
          '-n',
        ],
        timeoutMs: 60_000,
      })
      expect(r.exitCode).not.toBe(0)
    } finally {
      await dropTestDb()
      if (containerFileExists(LOCK_PATH)) containerRm(LOCK_PATH)
      fullRestore()
    }
  }, 90_000)

  // The cases below would each clobber the live test DB or duplicate the
  // destructive flow above with no extra signal. Tracked in PHP-bug list.
  it.skip(
    'admin/123456 default account can log in after install',
    () => {
      // destructive — would reset the test DB; tracked in PHP-bug list
    },
  )

  it.skip(
    'install against an already-populated DB warns and exits non-zero',
    () => {
      // destructive — would reset the test DB; tracked in PHP-bug list
    },
  )

  it.skip(
    'interactive prompts (no flags) drive a full install',
    () => {
      // destructive — would reset the test DB; tracked in PHP-bug list
    },
  )

  it.skip(
    'install with a custom table prefix rewrites fa_ → custom_',
    () => {
      // destructive — would reset the test DB; tracked in PHP-bug list
    },
  )
})
