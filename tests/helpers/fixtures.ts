// Per-test fixture builders. Insert directly into MySQL (no HTTP) to keep tests
// independent of controller bugs they may be exercising.
//
// Each builder:
//   - Generates unique values (timestamp + random) so concurrent tests don't collide.
//   - Tracks the created row's primary key for cleanupTracked() to wipe after the test.
//   - Returns the full row shape, including server-side defaults.
import mysql from 'mysql2/promise'
import crypto from 'node:crypto'
import { connectAsApp, loadDbConfig } from '../../scripts/db.ts'
import { fastadminHash } from '../../scripts/hash.ts'

const cfg = loadDbConfig()
const PFX = cfg.prefix

let pool: mysql.Connection | null = null
async function db(): Promise<mysql.Connection> {
  if (!pool) pool = await connectAsApp(cfg)
  return pool
}

export async function closeFixtureConnection(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

function rand(n: number): string {
  return crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n)
}

function uniqueSuffix(): string {
  // Must fit inside short varchar columns; fa_admin.username is varchar(20).
  // 4-char base36 + 4-char random = 8 chars (rolls over every ~10 days).
  return `${(Date.now() % 1679616).toString(36).padStart(4, '0')}${rand(4)}`
}

// ------------ tracking ------------
interface TrackEntry { table: string; id: number }
const tracked: TrackEntry[] = []

export function trackForCleanup(table: string, id: number): void {
  tracked.push({ table, id })
}

export async function cleanupTracked(): Promise<void> {
  const conn = await db()
  // delete in reverse insertion order to respect FK-ish dependencies
  while (tracked.length > 0) {
    const t = tracked.pop()!
    await conn.query(`DELETE FROM \`${t.table}\` WHERE id = ?`, [t.id]).catch(() => {})
  }
}

// ------------ admin ------------
export interface AdminFixture {
  id: number; username: string; nickname: string; password: string; salt: string;
  email: string; mobile: string; group_id: number; status: 'normal' | 'hidden';
}

export async function makeAdmin(overrides: Partial<AdminFixture> = {}): Promise<AdminFixture> {
  const sfx = uniqueSuffix()
  const salt = rand(4)
  const password = '123456'
  const row: AdminFixture = {
    id: 0,
    username: overrides.username ?? `ta_${sfx}`,        // 11 chars, fits varchar(20)
    nickname: overrides.nickname ?? `t_${sfx}`,
    password: overrides.password ?? password,
    salt: overrides.salt ?? salt,
    email: overrides.email ?? `${sfx}@test.local`,
    mobile: overrides.mobile ?? `139${Date.now().toString().slice(-8)}`,
    // Default to group 1 (super, rules='*') so created admins can access any
    // controller without surprise 403s. Tests asserting permission isolation
    // should pass `group_id: 2` explicitly.
    group_id: overrides.group_id ?? 1,
    status: overrides.status ?? 'normal',
  }
  const now = Math.floor(Date.now() / 1000)
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}admin\` (username, nickname, password, salt, email, mobile, createtime, updatetime, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.username, row.nickname, fastadminHash(row.password, row.salt), row.salt,
     row.email, row.mobile, now, now, row.status],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}auth_group_access`, row.id) // ignore-id; cleaned via uid below
  await (await db()).query(
    `INSERT INTO \`${PFX}auth_group_access\` (uid, group_id) VALUES (?, ?)`,
    [row.id, row.group_id],
  )
  trackForCleanup(`${PFX}admin`, row.id)
  return row
}

// ------------ user (frontend) ------------
export interface UserFixture {
  id: number; username: string; nickname: string; password: string; salt: string;
  email: string; mobile: string; group_id: number; status: 'normal' | 'hidden';
}

export async function makeUser(overrides: Partial<UserFixture> = {}): Promise<UserFixture> {
  const sfx = uniqueSuffix()
  const row: UserFixture = {
    id: 0,
    username: overrides.username ?? `tu_${sfx}`,        // 11 chars, fits varchar(32)
    nickname: overrides.nickname ?? `u_${sfx}`,
    password: overrides.password ?? '123456',
    salt: overrides.salt ?? rand(4),
    email: overrides.email ?? `${sfx}@test.local`,
    mobile: overrides.mobile ?? `137${Date.now().toString().slice(-8)}`,
    group_id: overrides.group_id ?? 1,
    status: overrides.status ?? 'normal',
  }
  const now = Math.floor(Date.now() / 1000)
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}user\` (group_id, username, nickname, password, salt, email, mobile,
        jointime, joinip, createtime, updatetime, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1', ?, ?, ?)`,
    [row.group_id, row.username, row.nickname, fastadminHash(row.password, row.salt), row.salt,
     row.email, row.mobile, now, now, now, row.status],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}user`, row.id)
  return row
}

// ------------ auth group ------------
export interface AuthGroupFixture {
  id: number; pid: number; name: string; rules: string; status: 'normal' | 'hidden';
}

export async function makeAuthGroup(overrides: Partial<AuthGroupFixture> = {}): Promise<AuthGroupFixture> {
  const sfx = uniqueSuffix()
  const row: AuthGroupFixture = {
    id: 0,
    pid: overrides.pid ?? 1,
    name: overrides.name ?? `t_group_${sfx}`,
    rules: overrides.rules ?? '',
    status: overrides.status ?? 'normal',
  }
  const now = Math.floor(Date.now() / 1000)
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}auth_group\` (pid, name, rules, createtime, updatetime, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.pid, row.name, row.rules, now, now, row.status],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}auth_group`, row.id)
  return row
}

// ------------ auth rule ------------
export interface AuthRuleFixture {
  id: number; type: 'menu' | 'file'; pid: number; name: string; title: string;
  ismenu: number; status: 'normal' | 'hidden';
}

export async function makeAuthRule(overrides: Partial<AuthRuleFixture> = {}): Promise<AuthRuleFixture> {
  const sfx = uniqueSuffix()
  const row: AuthRuleFixture = {
    id: 0,
    type: overrides.type ?? 'menu',
    pid: overrides.pid ?? 0,
    name: overrides.name ?? `t/rule/${sfx}`,
    title: overrides.title ?? `Rule ${sfx}`,
    ismenu: overrides.ismenu ?? 1,
    status: overrides.status ?? 'normal',
  }
  const now = Math.floor(Date.now() / 1000)
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}auth_rule\` (type, pid, name, title, ismenu, createtime, updatetime, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.type, row.pid, row.name, row.title, row.ismenu, now, now, row.status],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}auth_rule`, row.id)
  return row
}

// ------------ category ------------
export interface CategoryFixture {
  id: number; pid: number; type: string; name: string; nickname: string;
  status: 'normal' | 'hidden'; weigh: number;
}

export async function makeCategory(overrides: Partial<CategoryFixture> = {}): Promise<CategoryFixture> {
  const sfx = uniqueSuffix()
  const row: CategoryFixture = {
    id: 0,
    pid: overrides.pid ?? 0,
    type: overrides.type ?? 'default',
    name: overrides.name ?? `t_cat_${sfx}`,
    nickname: overrides.nickname ?? `Cat ${sfx}`,
    status: overrides.status ?? 'normal',
    weigh: overrides.weigh ?? 0,
  }
  const now = Math.floor(Date.now() / 1000)
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}category\` (pid, type, name, nickname, flag, image, keywords,
        description, diyname, createtime, updatetime, weigh, status)
     VALUES (?, ?, ?, ?, '', '', '', '', '', ?, ?, ?, ?)`,
    [row.pid, row.type, row.name, row.nickname, now, now, row.weigh, row.status],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}category`, row.id)
  return row
}

// ------------ config ------------
export interface ConfigFixture {
  id: number; name: string; group: string; title: string; type: string; value: string;
}

export async function makeConfig(overrides: Partial<ConfigFixture> = {}): Promise<ConfigFixture> {
  const sfx = uniqueSuffix()
  const row: ConfigFixture = {
    id: 0,
    name: overrides.name ?? `t_cfg_${sfx}`,
    group: overrides.group ?? 'basic',
    title: overrides.title ?? `Cfg ${sfx}`,
    type: overrides.type ?? 'string',
    value: overrides.value ?? '',
  }
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}config\` (name, \`group\`, title, type, value, content, rule, extend, setting, tip)
     VALUES (?, ?, ?, ?, ?, '', '', '', '', '')`,
    [row.name, row.group, row.title, row.type, row.value],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}config`, row.id)
  return row
}

// ------------ attachment ------------
export interface AttachmentFixture {
  id: number; admin_id: number; user_id: number; url: string; mimetype: string;
}

export async function makeAttachment(overrides: Partial<AttachmentFixture> = {}): Promise<AttachmentFixture> {
  const sfx = uniqueSuffix()
  const row: AttachmentFixture = {
    id: 0,
    admin_id: overrides.admin_id ?? 0,
    user_id: overrides.user_id ?? 0,
    url: overrides.url ?? `/uploads/test/${sfx}.txt`,
    mimetype: overrides.mimetype ?? 'text/plain',
  }
  const now = Math.floor(Date.now() / 1000)
  const [res] = await (await db()).query(
    `INSERT INTO \`${PFX}attachment\` (admin_id, user_id, url, imagewidth, imageframes,
        filesize, mimetype, extparam, createtime, updatetime, uploadtime, storage, sha1)
     VALUES (?, ?, ?, '', 0, 0, ?, '', ?, ?, ?, 'local', '')`,
    [row.admin_id, row.user_id, row.url, row.mimetype, now, now, now],
  )
  row.id = (res as mysql.ResultSetHeader).insertId
  trackForCleanup(`${PFX}attachment`, row.id)
  return row
}
