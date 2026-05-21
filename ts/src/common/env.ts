// Reads test/dev configuration from the same .env.test the PHP baseline uses.
// Keeping a single source of truth means tests can run against PHP or TS with
// identical DB/Redis/Mailhog targets.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

function readFile(): Record<string, string> {
  const file = path.join(ROOT, '.env.test')
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

const file = readFile()

export function env(name: string, fallback = ''): string {
  return process.env[name] ?? file[name] ?? fallback
}

export interface DbConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  prefix: string
}

export function loadDbConfig(): DbConfig {
  return {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3787')),
    user: env('DB_USER', 'fastadmin_test'),
    password: env('DB_PASSWORD', 'fastadmin_test'),
    database: env('DB_NAME', 'fastadmin_test'),
    prefix: env('DB_PREFIX', 'fa_'),
  }
}
