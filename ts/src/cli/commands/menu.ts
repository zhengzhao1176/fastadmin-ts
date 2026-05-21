// `bin/think menu -c <name>` — sync fa_auth_rule rows so a controller's
// actions appear in the admin sidebar. Mirrors `php think menu`.
import { Command } from 'commander'
import mysql from 'mysql2/promise'
import { loadDbConfig } from '../../common/env.ts'

const DEFAULT_ACTIONS = ['index', 'add', 'edit', 'del', 'multi']

export function register(prog: Command): void {
  prog
    .command('menu')
    .description('Insert / refresh fa_auth_rule rows for an admin controller.')
    .requiredOption('-c, --controller <name>', 'Controller name (e.g. category, user/user)')
    .option('--title <title>', 'Menu title (defaults to controller name)')
    .option('--pid <pid>', 'Parent rule id', '0')
    .option('-f, --force', 'Re-create rows (deletes then inserts)', false)
    .option('-d, --delete', 'Delete all rows for this controller', false)
    .action(async (opts: { controller: string; title?: string; pid: string; force: boolean; delete: boolean }) => {
      try {
        await runMenu(opts)
        process.exit(0)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('❌ menu sync failed:', (e as Error).message)
        process.exit(1)
      }
    })
}

async function runMenu(opts: {
  controller: string; title?: string; pid: string; force: boolean; delete: boolean
}): Promise<void> {
  const cfg = loadDbConfig()
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port,
    user: cfg.user, password: cfg.password, database: cfg.database,
  })
  try {
    const tbl = `${cfg.prefix}auth_rule`
    const parent = opts.controller
    const title = opts.title ?? parent

    if (opts.delete) {
      const [res] = await conn.query(
        `DELETE FROM \`${tbl}\` WHERE name = ? OR name LIKE ?`,
        [parent, `${parent}/%`],
      )
      // eslint-disable-next-line no-console
      console.log(`✅ deleted ${(res as { affectedRows: number }).affectedRows} rule rows for "${parent}"`)
      return
    }

    if (opts.force) {
      await conn.query(`DELETE FROM \`${tbl}\` WHERE name = ? OR name LIKE ?`, [parent, `${parent}/%`])
    }

    const now = Math.floor(Date.now() / 1000)
    const pid = parseInt(opts.pid, 10) || 0

    // Insert parent (idempotent — INSERT IGNORE-equivalent via existence check).
    const [exists] = await conn.query(`SELECT id FROM \`${tbl}\` WHERE name = ? LIMIT 1`, [parent])
    let parentId: number
    if ((exists as Array<{ id: number }>).length > 0) {
      parentId = (exists as Array<{ id: number }>)[0]!.id
    } else {
      const [res] = await conn.query(
        `INSERT INTO \`${tbl}\` (type, pid, name, title, ismenu, weigh, createtime, updatetime, status)
         VALUES ('file', ?, ?, ?, 1, 0, ?, ?, 'normal')`,
        [pid, parent, title, now, now],
      )
      parentId = (res as { insertId: number }).insertId
    }

    let inserted = 0
    for (const action of DEFAULT_ACTIONS) {
      const fullName = `${parent}/${action}`
      const [c] = await conn.query(`SELECT id FROM \`${tbl}\` WHERE name = ? LIMIT 1`, [fullName])
      if ((c as unknown[]).length > 0) continue
      await conn.query(
        `INSERT INTO \`${tbl}\` (type, pid, name, title, ismenu, weigh, createtime, updatetime, status)
         VALUES ('file', ?, ?, ?, 0, 0, ?, ?, 'normal')`,
        [parentId, fullName, action[0]!.toUpperCase() + action.slice(1), now, now],
      )
      inserted++
    }
    // eslint-disable-next-line no-console
    console.log(`✅ menu synced — parent=${parent} (id=${parentId}), ${inserted} new action rules`)
  } finally {
    await conn.end()
  }
}
