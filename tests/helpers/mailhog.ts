// MailHog inspection helpers. The compose service captures all SMTP traffic
// from the PHP container; this exposes /api/v2/messages over HTTP so tests can
// verify mail without integrating a real provider.
import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function envFromFile(): Record<string, string> {
  const out: Record<string, string> = {}
  const file = path.resolve(__dirname, '../../.env.test')
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

function mailhogBase(): string {
  const env = envFromFile()
  const host = process.env.MAILHOG_HTTP_HOST ?? env.MAILHOG_HTTP_HOST ?? '127.0.0.1'
  const port = process.env.MAILHOG_HTTP_PORT ?? env.MAILHOG_HTTP_PORT ?? '8025'
  return `http://${host}:${port}`
}

export interface MailhogMessage {
  ID: string
  From: { Mailbox: string; Domain: string; Params: string }
  To: Array<{ Mailbox: string; Domain: string; Params: string }>
  Content: { Headers: Record<string, string[]>; Body: string; Size: number; MIME: unknown }
  Created: string
}

/** Delete all captured mails. Call in beforeEach to keep test isolation. */
export async function clearMailbox(): Promise<void> {
  await axios.delete(`${mailhogBase()}/api/v1/messages`, { validateStatus: () => true })
}

/** Fetch every captured mail (newest first per MailHog convention). */
export async function listMail(): Promise<MailhogMessage[]> {
  const r = await axios.get<{ items: MailhogMessage[] }>(`${mailhogBase()}/api/v2/messages`)
  return r.data?.items ?? []
}

/** Wait up to `timeoutMs` for at least `n` messages to land. */
export async function waitForMail(n = 1, timeoutMs = 5_000): Promise<MailhogMessage[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const items = await listMail()
    if (items.length >= n) return items
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`MailHog: expected >=${n} message(s) within ${timeoutMs}ms, got ${(await listMail()).length}`)
}

/** Address sugar: `{ Mailbox: 'foo', Domain: 'bar.com' }` → 'foo@bar.com'. */
export function addr(a: { Mailbox: string; Domain: string }): string {
  return `${a.Mailbox}@${a.Domain}`
}
