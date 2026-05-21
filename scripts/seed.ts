// Apply test seed on top of an already-installed FastAdmin schema.
// Idempotent: safe to call repeatedly; deletes test fixtures first then re-inserts.
import fs from 'node:fs'
import path from 'node:path'
import { connectAsApp, loadDbConfig, PROJECT_ROOT } from './db.ts'
import { fastadminHash } from './hash.ts'

interface SeedAdmin { id: number; username: string; password: string; salt: string; group_id: number }
interface SeedUser { id: number; username: string; password: string; salt: string; mobile: string; email: string; group_id: number; status: string }
interface SeedGroup { id: number; pid: number; name: string; rules: string; status: string }
interface SeedCategory { id: number; pid: number; type: string; name: string; nickname: string; status: string; weigh: number }
interface SeedFile {
  admin: { super: SeedAdmin; subadmin: SeedAdmin }
  user: { alice: SeedUser; bob: SeedUser; banned: SeedUser }
  auth_group: SeedGroup[]
  category: SeedCategory[]
}

const SEED_PATH = path.join(PROJECT_ROOT, 'tests/fixtures/seed-data.json')

function loadSeed(): SeedFile {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as SeedFile
}

export async function seed(): Promise<void> {
  const cfg = loadDbConfig()
  const seed = loadSeed()
  const db = await connectAsApp(cfg)
  try {
    const now = Math.floor(Date.now() / 1000)

    // Wipe ship-default rows from install.sql so test fixtures own these tables.
    await db.query(`DELETE FROM \`${cfg.prefix}admin\``)
    await db.query(`DELETE FROM \`${cfg.prefix}auth_group_access\``)
    await db.query(`DELETE FROM \`${cfg.prefix}user\``)

    // Admins ----------------------------------------------------------------
    for (const a of [seed.admin.super, seed.admin.subadmin]) {
      const password = fastadminHash(a.password, a.salt)
      await db.query(
        `INSERT INTO \`${cfg.prefix}admin\`
           (id, username, nickname, password, salt, email, createtime, updatetime, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'normal')`,
        [a.id, a.username, a.username, password, a.salt, `${a.username}@test.local`, now, now],
      )
      await db.query(
        `INSERT INTO \`${cfg.prefix}auth_group_access\` (uid, group_id) VALUES (?, ?)`,
        [a.id, a.group_id],
      )
    }

    // Auth groups -----------------------------------------------------------
    for (const g of seed.auth_group) {
      await db.query(
        `INSERT INTO \`${cfg.prefix}auth_group\` (id, pid, name, rules, createtime, updatetime, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE pid=VALUES(pid), name=VALUES(name), rules=VALUES(rules), status=VALUES(status)`,
        [g.id, g.pid, g.name, g.rules, now, now, g.status],
      )
    }

    // Frontend users --------------------------------------------------------
    // The fa_user_group table may already have id=1 from install.sql; reuse it.
    await db.query(
      `INSERT INTO \`${cfg.prefix}user_group\` (id, name, rules, createtime, updatetime, status)
       VALUES (1, 'Default group', '1,2,3,4,5,6,7,8,9,10,11,12', ?, ?, 'normal')
       ON DUPLICATE KEY UPDATE name=VALUES(name), rules=VALUES(rules)`,
      [now, now],
    )
    for (const u of [seed.user.alice, seed.user.bob, seed.user.banned]) {
      const password = fastadminHash(u.password, u.salt)
      await db.query(
        `INSERT INTO \`${cfg.prefix}user\`
           (id, group_id, username, nickname, password, salt, email, mobile, jointime, joinip,
            createtime, updatetime, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1', ?, ?, ?)`,
        [u.id, u.group_id, u.username, u.username, password, u.salt, u.email, u.mobile,
         now, now, now, u.status],
      )
    }

    // Categories ------------------------------------------------------------
    for (const c of seed.category) {
      await db.query(
        `INSERT INTO \`${cfg.prefix}category\`
           (id, pid, type, name, nickname, flag, image, keywords, description, diyname, createtime, updatetime, weigh, status)
         VALUES (?, ?, ?, ?, ?, '', '', '', '', '', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), nickname=VALUES(nickname), status=VALUES(status)`,
        [c.id, c.pid, c.type, c.name, c.nickname, now, now, c.weigh, c.status],
      )
    }

    // Test-time config overrides ------------------------------------------
    // ThinkPHP merges application/extra/<group>.php into Config::get($group).
    // We override only the keys that make tests painful (captcha, rate limit).
    const extraDir = path.join(PROJECT_ROOT, 'fastAdmin/application/extra')
    const fastadminOverride = path.join(extraDir, 'fastadmin.php')
    // Always rewrite — keeps overrides in sync if we add new keys.
    fs.writeFileSync(fastadminOverride, [
      '<?php',
      '// Test-only overrides (written by scripts/seed.ts). Safe to delete.',
      'return [',
      "    'login_captcha'         => false,",
      "    'login_failure_retry'   => false,",
      "    'user_register_captcha' => '',         // disable text/sms/email captcha on register",
      '];',
      '',
    ].join('\n'))

    // Point SMTP at MailHog (test-only capture). The mail_* DB rows alone are
    // NOT enough — FastAdmin's runtime reads from `application/extra/site.php`,
    // which is regenerated only on admin/config/edit. We update both: DB rows
    // (so admin UI is consistent) and the extra/site.php file directly so the
    // running PHP picks up our mailhog endpoint immediately.
    await db.query(
      `UPDATE \`${cfg.prefix}config\` SET value = ? WHERE name = 'mail_type'`,
      ['2'],
    )
    await db.query(
      `UPDATE \`${cfg.prefix}config\` SET value = ? WHERE name = 'mail_smtp_host'`,
      ['mailhog'],
    )
    await db.query(
      `UPDATE \`${cfg.prefix}config\` SET value = ? WHERE name = 'mail_smtp_port'`,
      ['1025'],
    )
    await db.query(
      `UPDATE \`${cfg.prefix}config\` SET value = ? WHERE name = 'mail_smtp_user'`,
      [''],
    )
    await db.query(
      `UPDATE \`${cfg.prefix}config\` SET value = ? WHERE name = 'mail_verify_type'`,
      ['0'],
    )
    await db.query(
      `UPDATE \`${cfg.prefix}config\` SET value = ? WHERE name = 'mail_from'`,
      ['noreply@test.local'],
    )

    // Patch extra/site.php to include the mail_* keys our DB rows want. The
    // file format is `<?php return array ( ... );` — append our keys before
    // the closing parenthesis.
    const sitePhp = path.join(PROJECT_ROOT, 'fastAdmin/application/extra/site.php')
    if (fs.existsSync(sitePhp)) {
      let txt = fs.readFileSync(sitePhp, 'utf8')
      const mailOverrides = [
        "  'mail_type' => '2',",
        "  'mail_smtp_host' => 'mailhog',",
        "  'mail_smtp_port' => '1025',",
        "  'mail_smtp_user' => '',",
        "  'mail_smtp_pass' => '',",
        "  'mail_verify_type' => '0',",
        "  'mail_from' => 'noreply@test.local',",
      ].join('\n')
      // Strip any previously injected mail_* keys then re-inject.
      txt = txt.replace(/\s*'mail_[a-z_]+' => '[^']*',?/g, '')
      // Inject right before the final `);`.
      txt = txt.replace(/(\n\);\s*$)/m, `\n${mailOverrides}\n);\n`)
      fs.writeFileSync(sitePhp, txt)
    }
    // Mark FastAdmin as installed so /index.php skips the installer redirect.
    const lockFile = path.join(PROJECT_ROOT, 'fastAdmin/application/admin/command/Install/install.lock')
    if (!fs.existsSync(lockFile)) {
      fs.writeFileSync(lockFile, new Date().toISOString())
    }
  } finally {
    await db.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().then(
    () => { console.log('[seed] done'); process.exit(0) },
    (err) => { console.error('[seed] failed:', err); process.exit(1) },
  )
}
