// Vitest globalSetup: one resetDb() per process. Per-test fixtures are created
// inline via fixtures.ts and cleaned up via cleanupTracked() in afterEach.
import { resetDb } from '../../scripts/reset-db.ts'

export async function setup(): Promise<void> {
  if (process.env.SKIP_DB_RESET === '1') {
    console.log('[global-setup] SKIP_DB_RESET=1; assuming DB is ready')
    return
  }
  const t0 = Date.now()
  await resetDb()
  console.log(`[global-setup] resetDb done in ${Date.now() - t0}ms`)
}

export async function teardown(): Promise<void> {
  // Intentionally empty — leaving the DB seeded between runs is fine for dev.
}
