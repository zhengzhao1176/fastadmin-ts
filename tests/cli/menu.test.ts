// `php think menu` — build/delete admin auth menu entries from controller files.
//
// The command reflects on `application/admin/controller/<path>.php`, parses
// docblocks, and upserts rows into `fa_auth_rule` (one parent + one per public
// action). Tests target the existing `auth/Admin` controller because its rule
// rows are seeded into `fastadmin_test`.
//
// Cleanup strategy: snapshot the IDs that match the controller's name prefix
// at the start of each test, then in afterEach delete any *new* IDs that
// appeared. The destructive delete-case re-runs build at the end to restore.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { runThink } from '../helpers/cli'
import { withApp } from '../../scripts/db.ts'
import { closeFixtureConnection } from '../helpers/fixtures'

// The auth/Admin controller is part of the FastAdmin seed; its menu rows have
// names 'auth/admin' and 'auth/admin/<action>'. We avoid 'auth/admin%' LIKE
// patterns when we need to be precise because that also matches 'auth/adminlog'.
const CTRL = 'auth/Admin'
const PREFIX_NAME = 'auth/admin' // lowercased
const NAME_FILTER_SQL =
  "name = 'auth/admin' OR name LIKE 'auth/admin/%'"

interface RuleRow { id: number; pid: number; name: string; title: string; ismenu: number }

async function selectRules(): Promise<RuleRow[]> {
  return await withApp(async (db) => {
    const [rows] = await db.query(
      `SELECT id, pid, name, title, ismenu FROM fa_auth_rule WHERE ${NAME_FILTER_SQL} ORDER BY id`,
    )
    return rows as RuleRow[]
  })
}

async function countRules(): Promise<number> {
  return await withApp(async (db) => {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS n FROM fa_auth_rule WHERE ${NAME_FILTER_SQL}`,
    )
    return Number((rows as { n: number }[])[0]?.n ?? 0)
  })
}

async function deleteByIds(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await withApp(async (db) => {
    await db.query(
      `DELETE FROM fa_auth_rule WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )
  })
}

// Snapshot of baseline IDs taken in beforeEach.
let baselineIds: Set<number> = new Set()

async function snapshotBaseline(): Promise<void> {
  const rows = await selectRules()
  baselineIds = new Set(rows.map((r) => r.id))
}

async function cleanupNewlyInserted(): Promise<void> {
  const rows = await selectRules()
  const newIds = rows.map((r) => r.id).filter((id) => !baselineIds.has(id))
  await deleteByIds(newIds)
}

describe('cli: php think menu', () => {
  beforeEach(async () => {
    await snapshotBaseline()
  })

  afterEach(async () => {
    await cleanupNewlyInserted()
  })

  afterAll(async () => {
    await closeFixtureConnection()
  })

  it('`php think menu --help` exits 0 and prints usage', () => {
    const r = runThink({ args: ['menu', '--help'] })
    expect(r.exitCode).toBe(0)
    const lower = r.combined.toLowerCase()
    expect(lower).toContain('usage')
    expect(lower).toContain('menu')
    expect(lower).toContain('--controller')
  })

  it('`php think menu` without -c errors (missing controller name)', () => {
    const r = runThink({ args: ['menu'] })
    // ThinkPHP wraps thrown Exception → non-zero exit + message in combined.
    expect(r.exitCode).not.toBe(0)
    expect(r.combined.toLowerCase()).toMatch(/controller/)
  })

  it(`\`php think menu -c ${CTRL}\` inserts auth rules for the controller's actions`, async () => {
    // Ensure no existing rows for the controller so we observe inserts.
    const beforeRows = await selectRules()
    await deleteByIds(beforeRows.map((r) => r.id))

    const r = runThink({ args: ['menu', '-c', CTRL] })
    expect(r.exitCode).toBe(0)
    expect(r.combined).toMatch(/Build Successed/i)

    const after = await selectRules()
    const names = after.map((row) => row.name)
    // Parent menu node + at least the CRUD actions (index/add/edit/del).
    expect(names).toContain('auth/admin')
    expect(names).toContain('auth/admin/index')
    expect(names).toContain('auth/admin/add')
    expect(names).toContain('auth/admin/edit')
    expect(names).toContain('auth/admin/del')

    // Parent is a menu (ismenu=1), child actions are not (ismenu=0).
    const parent = after.find((row) => row.name === 'auth/admin')!
    const child = after.find((row) => row.name === 'auth/admin/index')!
    expect(parent.ismenu).toBe(1)
    expect(child.ismenu).toBe(0)
    expect(child.pid).toBe(parent.id)
  })

  it('re-running the same -c is idempotent (no row count growth)', async () => {
    const first = runThink({ args: ['menu', '-c', CTRL] })
    expect(first.exitCode).toBe(0)
    const countAfterFirst = await countRules()

    const second = runThink({ args: ['menu', '-c', CTRL] })
    expect(second.exitCode).toBe(0)
    const countAfterSecond = await countRules()

    expect(countAfterSecond).toBe(countAfterFirst)
  })

  it('`-d 1 -f 1` deletes the controller menu rows', async () => {
    // Make sure there is something to delete (insert if baseline was empty).
    runThink({ args: ['menu', '-c', CTRL] })
    const before = await countRules()
    expect(before).toBeGreaterThan(0)

    const r = runThink({ args: ['menu', '-c', CTRL, '-d', '1', '-f', '1'] })
    expect(r.exitCode).toBe(0)
    expect(r.combined).toMatch(/Delete Successed/i)

    // After delete, the controller's own rows must be gone.
    const remaining = await selectRules()
    expect(remaining.length).toBe(0)

    // Restore the seed entries so the next test (and global state) is intact.
    // The delete also removes any prior baseline rows, so re-build them.
    const restore = runThink({ args: ['menu', '-c', CTRL] })
    expect(restore.exitCode).toBe(0)
  })

  it('`-c does/not/Exist` reports "controller not found" without inserting rows', async () => {
    const before = await countRules()
    const r = runThink({ args: ['menu', '-c', 'does/not/Exist'] })
    // Observed behaviour: exit code 0 but error printed; no DB mutation.
    expect(r.combined.toLowerCase()).toContain('controller not found')
    const after = await countRules()
    expect(after).toBe(before)
  })

  it('`-c all-controller` rebuilds menus across modules (parent rows present)', async () => {
    // This command wipes auth_rule and reimports everything — heavy but supported.
    const r = runThink({ args: ['menu', '-c', 'all-controller'], timeoutMs: 120_000 })
    expect(r.exitCode).toBe(0)
    expect(r.combined).toMatch(/Build Successed/i)

    // After a full rebuild the seeded controller rows reappear.
    const after = await selectRules()
    const names = after.map((row) => row.name)
    expect(names).toContain('auth/admin')
    expect(names).toContain('auth/admin/index')

    // After all-controller, every ID is new (the command wipes & re-inserts).
    // Reset baseline so afterEach treats them as kept rather than nuking the
    // freshly rebuilt seed.
    await snapshotBaseline()
  })
})
