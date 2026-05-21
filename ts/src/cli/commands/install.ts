// `bin/think install` — first-time setup: provision the DB schema, seed the
// default admin account, write the install.lock file.
//
// Usage:
//   node bin/think.js install \
//     --hostname=127.0.0.1 --hostport=3306 --database=fastadmin \
//     --username=root --password=secret --prefix=fa_ \
//     --adminname=admin --adminpassword=123456 --adminemail=a@b.test \
//     [--force]
import { Command } from 'commander'
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const LOCK_PATH = path.join(REPO_ROOT, 'install.lock')
const SQL_PATH = path.resolve(REPO_ROOT, 'scripts', 'install.sql')

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex')
}

function fastadminHash(pw: string, salt: string): string {
  return md5(md5(pw) + salt)
}

function randomSalt(len = 4): string {
  return crypto.randomBytes(len).toString('hex').slice(0, len)
}

export function register(prog: Command): void {
  prog
    .command('install')
    .description('Provision the database schema and seed the first admin account.')
    .option('--hostname <host>', 'MySQL host', '127.0.0.1')
    .option('--hostport <port>', 'MySQL port', '3306')
    .option('--database <name>', 'Database name', 'fastadmin')
    .option('--username <user>', 'DB username', 'root')
    .option('--password <pw>', 'DB password', '')
    .option('--prefix <prefix>', 'Table prefix', 'fa_')
    .option('--adminname <name>', 'First admin username', 'admin')
    .option('--adminpassword <pw>', 'First admin password', '123456')
    .option('--adminemail <email>', 'First admin email', 'admin@fastadmin.net')
    .option('--force', 'Re-install even if install.lock exists', false)
    .action(async (opts: {
      hostname: string; hostport: string; database: string;
      username: string; password: string; prefix: string;
      adminname: string; adminpassword: string; adminemail: string;
      force: boolean
    }) => {
      try {
        await runInstall(opts)
        // eslint-disable-next-line no-console
        console.log('✅ install complete')
        process.exit(0)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('❌ install failed:', (e as Error).message)
        process.exit(1)
      }
    })
}

async function runInstall(opts: {
  hostname: string; hostport: string; database: string;
  username: string; password: string; prefix: string;
  adminname: string; adminpassword: string; adminemail: string;
  force: boolean
}): Promise<void> {
  if (fs.existsSync(LOCK_PATH) && !opts.force) {
    throw new Error(`install.lock exists at ${LOCK_PATH} — already installed. Use --force to reinstall.`)
  }

  if (!fs.existsSync(SQL_PATH)) {
    throw new Error(`install.sql not found at ${SQL_PATH}`)
  }

  // 1. Connect to MySQL (no database selected yet, so we can CREATE it).
  const port = parseInt(opts.hostport, 10) || 3306
  const root = await mysql.createConnection({
    host: opts.hostname, port,
    user: opts.username, password: opts.password,
    multipleStatements: true,
  }).catch((e) => {
    throw new Error(`MySQL connect failed (${opts.hostname}:${port}): ${(e as Error).message}`)
  })

  try {
    // 2. CREATE DATABASE IF NOT EXISTS.
    await root.query(
      `CREATE DATABASE IF NOT EXISTS \`${opts.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    )
    await root.query(`USE \`${opts.database}\``)

    // 3. Run install.sql. The SQL uses `fa_` as the prefix; rewrite if user changed it.
    let sql = fs.readFileSync(SQL_PATH, 'utf8')
    if (opts.prefix !== 'fa_') {
      sql = sql.replace(/`fa_/g, '`' + opts.prefix)
    }
    // Strip SQL comments and BEGIN/COMMIT pairs that mysql2 chokes on with multipleStatements.
    sql = sql.replace(/^--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

    // eslint-disable-next-line no-console
    console.log(`→ applying schema to ${opts.database}…`)
    await root.query(sql)

    // 4. Update / insert the first admin. install.sql ships an admin record; we
    //    overwrite it with the user-supplied credentials.
    const salt = randomSalt()
    const hash = fastadminHash(opts.adminpassword, salt)
    const now = Math.floor(Date.now() / 1000)
    await root.query(
      `UPDATE \`${opts.prefix}admin\` SET username = ?, password = ?, salt = ?, email = ?, updatetime = ? WHERE id = 1`,
      [opts.adminname, hash, salt, opts.adminemail, now],
    )
    // eslint-disable-next-line no-console
    console.log(`→ first admin: username=${opts.adminname}`)

    // 5. Write install.lock with a tiny metadata blob.
    fs.writeFileSync(LOCK_PATH, JSON.stringify({
      installedAt: new Date().toISOString(),
      database: opts.database,
      adminUsername: opts.adminname,
    }, null, 2))
    // eslint-disable-next-line no-console
    console.log(`→ wrote ${LOCK_PATH}`)
  } finally {
    await root.end()
  }
}
