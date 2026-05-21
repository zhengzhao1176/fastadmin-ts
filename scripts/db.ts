// Shared MySQL connection helpers. All scripts and tests should go through here.
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export interface DbConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  rootPassword: string
  prefix: string
}

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

export function loadDbConfig(): DbConfig {
  const file = readEnvFile(path.join(ROOT, '.env.test'))
  const env = (k: string, dflt: string) => process.env[k] ?? file[k] ?? dflt
  return {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3787')),
    user: env('DB_USER', 'fastadmin_test'),
    password: env('DB_PASSWORD', 'fastadmin_test'),
    database: env('DB_NAME', 'fastadmin_test'),
    rootPassword: env('DB_ROOT_PASSWORD', 'root_for_test'),
    prefix: env('DB_PREFIX', 'fa_'),
  }
}

export async function connectAsRoot(cfg: DbConfig = loadDbConfig()): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: 'root',
    password: cfg.rootPassword,
    multipleStatements: true,
  })
}

export async function connectAsApp(cfg: DbConfig = loadDbConfig()): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    multipleStatements: true,
  })
}

export async function withApp<T>(fn: (db: mysql.Connection) => Promise<T>): Promise<T> {
  const db = await connectAsApp()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}

export const PROJECT_ROOT = ROOT
