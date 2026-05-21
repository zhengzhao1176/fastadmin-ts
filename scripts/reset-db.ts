// Drop and recreate the test DB, load FastAdmin schema, apply seed.
// Use sparingly (once per test file in beforeAll). Each test should clean up its
// own fixtures rather than calling resetDb() per-test.
import fs from 'node:fs'
import path from 'node:path'
import { connectAsRoot, loadDbConfig, PROJECT_ROOT } from './db.ts'
import { seed } from './seed.ts'

const INSTALL_SQL = path.join(
  PROJECT_ROOT,
  'fastAdmin/application/admin/command/Install/fastadmin.sql',
)

export async function resetDb(): Promise<void> {
  const cfg = loadDbConfig()
  if (!fs.existsSync(INSTALL_SQL)) {
    throw new Error(`install SQL not found: ${INSTALL_SQL}`)
  }
  const sql = fs.readFileSync(INSTALL_SQL, 'utf8')

  const root = await connectAsRoot(cfg)
  try {
    // Recreate database.
    await root.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``)
    await root.query(
      `CREATE DATABASE \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    // Grant (idempotent — user may already exist).
    await root.query(
      `GRANT ALL PRIVILEGES ON \`${cfg.database}\`.* TO ?@'%'`,
      [cfg.user],
    )
    await root.query('FLUSH PRIVILEGES')

    // Load schema via root (the app user lacks CREATE on some MySQL configs).
    await root.query(`USE \`${cfg.database}\``)
    await root.query(sql)
  } finally {
    await root.end()
  }

  await seed()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now()
  resetDb().then(
    () => { console.log(`[reset-db] done in ${Date.now() - t0}ms`); process.exit(0) },
    (err) => { console.error('[reset-db] failed:', err); process.exit(1) },
  )
}
