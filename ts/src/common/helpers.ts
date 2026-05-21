// FastAdmin global helper functions — ports of the most-used pieces of PHP
// `application/common.php` (docs 1262 扩展 / 1263 函数). Kept pure (no DB / no
// request context) so they are unit-testable; the few helpers that genuinely
// need request state (the `domain=true` branch of url()/cdnurl(), addtion()'s
// relation lookup) accept the needed value as an explicit argument instead.
import { human } from './date.ts'

const ABS_OR_DATA = /^((?:[a-z]+:)?\/\/|data:image\/)/i

/** `format_bytes()` — humanise a byte count (`512` → `512B`, `1024` → `1KB`). */
export function formatBytes(size: number, delimiter = '', precision = 2): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let s = Number(size) || 0
  let i = 0
  for (; s >= 1024 && i < 5; i++) s /= 1024
  const f = 10 ** precision
  return `${Math.round(s * f) / f}${delimiter}${units[i]}`
}

/** `datetime()` — format a unix timestamp (or date string) with a PHP-`date` mask. */
export function datetime(time: number | string, format = 'Y-m-d H:i:s'): string {
  let ts: number
  if (typeof time === 'number') ts = time
  else if (/^\d+$/.test(String(time).trim())) ts = Number(time)
  else ts = Math.floor(Date.parse(String(time)) / 1000) || 0
  const d = new Date(ts * 1000)
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const map: Record<string, string> = {
    Y: String(d.getFullYear()), m: p2(d.getMonth() + 1), d: p2(d.getDate()),
    H: p2(d.getHours()), i: p2(d.getMinutes()), s: p2(d.getSeconds()),
  }
  return format.replace(/[YmdHis]/g, (c) => map[c] ?? c)
}

/** `human_date()` — semantic relative time. Delegates to `\fast\Date::human`. */
export function humanDate(time: number, local?: number): string {
  return human(time, local)
}

/**
 * `cdnurl()` — complete an upload-resource URL. Absolute URLs and `data:image`
 * URIs pass through untouched. `domain` may be an explicit domain string to
 * prepend (the PHP `domain=true` request-domain branch needs request context,
 * so callers pass the resolved domain string).
 */
export function cdnurl(url: string, domain: string | boolean = false): string {
  const cdn = process.env.UPLOAD_CDNURL || ''
  let out = String(url)
  if (typeof domain === 'boolean' || cdn.startsWith('/')) {
    out = ABS_OR_DATA.test(out) || (cdn !== '' && out.startsWith(cdn)) ? out : cdn + out
  }
  if (domain && !ABS_OR_DATA.test(out)) {
    const d = typeof domain === 'string' ? (/^https?:\/\//i.test(domain) ? domain : `http://${domain}`) : ''
    out = d + out
  }
  return out
}

/**
 * `url()` — build a page URL. `vars` become a query string; a string `domain`
 * is prepended (bare host → `http://`). The module-aware admin-entry rewrite
 * and `.html` suffix are request-context dependent and intentionally omitted.
 */
export function url(
  pathStr: string,
  vars: Record<string, unknown> = {},
  suffix: boolean | string = true,
  domain: boolean | string = false,
): string {
  void suffix
  let out = String(pathStr)
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(vars ?? {})) qs.append(k, String(v))
  const q = qs.toString()
  if (q) out += (out.includes('?') ? '&' : '?') + q
  if (typeof domain === 'string' && domain !== '') {
    out = (/^https?:\/\//i.test(domain) ? domain : `http://${domain}`) + out
  }
  return out
}

/** `mb_ucfirst()` — uppercase the first character. */
export function mbUcfirst(s: string): string {
  const str = String(s ?? '')
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// --- adler32 + hsv→rgb, shared by letter_avatar / build_suffix_image --------

function adler32(s: string): number {
  const buf = Buffer.from(s, 'utf8')
  let a = 1
  let b = 0
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]!) % 65521
    b = (b + a) % 65521
  }
  return (((b << 16) >>> 0) | a) >>> 0
}

/** PHP does `unpack('L', hash('adler32', $x, true))` — i.e. the adler32 value
 *  read back little-endian, so the bytes are swapped relative to the hash. */
function adler32LE(s: string): number {
  const v = adler32(s)
  return (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | ((v >>> 24) & 0xff)) >>> 0
}

function hsv2rgb(h: number, sat: number, val: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = val * (1 - sat)
  const q = val * (1 - f * sat)
  const t = val * (1 - (1 - f) * sat)
  let r = 0
  let g = 0
  let b = 0
  switch (((i % 6) + 6) % 6) {
    case 0: r = val; g = t; b = p; break
    case 1: r = q; g = val; b = p; break
    case 2: r = p; g = val; b = t; break
    case 3: r = p; g = q; b = val; break
    case 4: r = t; g = p; b = val; break
    default: r = val; g = p; b = q; break
  }
  return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)]
}

/** `letter_avatar()` — first-letter avatar as an `data:image/svg+xml;base64` URI. */
export function letterAvatar(text: string): string {
  const hue = adler32LE(String(text)) % 360
  const [r, g, b] = hsv2rgb(hue / 360, 0.3, 0.9)
  const first = (String(text).charAt(0) || '').toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" height="100" width="100">`
    + `<rect fill="rgb(${r},${g},${b})" x="0" y="0" width="100" height="100"></rect>`
    + `<text x="50" y="50" font-size="50" fill="#ffffff" text-anchor="middle" `
    + `dominant-baseline="central">${first}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

/** `build_suffix_image()` — a file-type icon SVG carrying the (≤4-char) suffix. */
export function buildSuffixImage(suffix: string, background?: string): string {
  const sfx = String(suffix).toUpperCase().slice(0, 4)
  const hue = adler32LE(sfx) % 360
  const [r, g, b] = hsv2rgb(hue / 360, 0.3, 0.9)
  const bg = background || `rgb(${r},${g},${b})`
  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 512 512">`
    + `<path style="fill:#E2E5E7;" d="M128,0c-17.6,0-32,14.4-32,32v448c0,17.6,14.4,32,32,32h320c17.6,0,32-14.4,32-32V128L352,0H128z"/>`
    + `<path style="fill:#B0B7BD;" d="M384,128h96L352,0v96C352,113.6,366.4,128,384,128z"/>`
    + `<path style="fill:${bg};" d="M416,416c0,8.8-7.2,16-16,16H48c-8.8,0-16-7.2-16-16V256c0-8.8,7.2-16,16-16h352c8.8,0,16,7.2,16,16V416z"/>`
    + `<text x="220" y="380" font-size="124" font-family="Verdana,Helvetica,Arial,sans-serif" `
    + `fill="white" text-anchor="middle">${sfx}</text></svg>`
}

/**
 * `xss_clean()` — strip script/style blocks, dangerous tags, inline event
 * handlers and script-scheme URIs from a string. A practical port of the
 * CodeIgniter-derived Security cleaner — plain text passes through unchanged.
 */
export function xssClean(content: string, isImage = false): string {
  if (typeof content !== 'string' || content === '') return content
  let s = content
  s = s.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '[removed]')
  s = s.replace(/<\s*\/?\s*(script|style)\b[^>]*>/gi, '[removed]')
  s = s.replace(/<\s*\/?\s*(iframe|object|embed|applet|frameset|frame|base|form)\b[^>]*>/gi, '')
  s = s.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/(javascript|vbscript|livescript|mocha)\s*:/gi, '[removed]:')
  if (!isImage) s = s.replace(/data\s*:(?!image\/)/gi, '[removed]:')
  return s
}

// --- IP allow-list (the pure half of check_ip_allowed) ---------------------

function ipv4ToInt(ip: string): number | null {
  const parts = String(ip).split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const x of parts) {
    const v = Number(x)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = ((n << 8) | v) >>> 0
  }
  return n
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/')
  const base = cidr.slice(0, slash)
  const bits = Number(cidr.slice(slash + 1))
  const ipN = ipv4ToInt(ip)
  const baseN = ipv4ToInt(base)
  if (ipN == null || baseN == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (ipN & mask) === (baseN & mask)
}

/**
 * `check_ip_allowed()` (pure form) — true when `ip` is NOT matched by any entry
 * of the forbidden-IP list. Entries may be exact IPs, CIDR ranges
 * (`10.0.0.0/24`) or `*` globs (`192.168.*.*`).
 */
export function ipAllowed(ip: string, denyList: string[]): boolean {
  for (const entryRaw of denyList ?? []) {
    const entry = String(entryRaw).trim()
    if (!entry) continue
    if (entry === ip) return false
    if (entry.includes('/') && ipv4InCidr(ip, entry)) return false
    if (entry.includes('*')) {
      const re = new RegExp(`^${entry.replace(/\./g, '\\.').replace(/\*/g, '\\d+')}$`)
      if (re.test(ip)) return false
    }
  }
  return true
}
