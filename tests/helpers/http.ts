// Black-box HTTP client for FastAdmin. Hides cookie jar / token header / URL
// composition / envelope decoding so tests can stay focused on behaviour.
import axios, { type AxiosInstance, type AxiosResponse, type Method } from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type FormData from 'form-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Response envelope. Note: `time` is a string in FastAdmin's JSON output. */
export interface Envelope<T = unknown> {
  code: number
  msg: string
  data: T
  time: string
  /** admin-side success/error returns these extra fields for jump behaviour. */
  url?: string
  wait?: number
}

export interface RequestOptions {
  method?: Method
  url: string                 // module-relative path; see resolveUrl below
  query?: Record<string, unknown>
  form?: Record<string, unknown>
  json?: Record<string, unknown>
  multipart?: FormData
  headers?: Record<string, string>
  cookies?: boolean           // default true
  ajax?: boolean              // sets X-Requested-With (default true)
}

export interface RawResponse<T = unknown> {
  status: number
  headers: Record<string, string>
  body: Envelope<T> | string
}

export interface HttpClient {
  request<T = unknown>(opts: RequestOptions): Promise<RawResponse<T>>
  json<T = unknown>(opts: RequestOptions): Promise<Envelope<T>>
  html(opts: RequestOptions): Promise<string>

  /** Extract `__token__` hidden input from a GET HTML page (CSRF). */
  fetchToken(formUrl: string): Promise<string>

  setToken(token: string | null): void
  getToken(): string | null

  getCookie(name: string): string | undefined
  clearCookies(): void

  readonly baseURL: string
  readonly axios: AxiosInstance
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

function defaultBaseURL(): string {
  if (process.env.FASTADMIN_BASE_URL) return process.env.FASTADMIN_BASE_URL
  const file = readEnvFile(path.resolve(__dirname, '../../.env.test'))
  return file.FASTADMIN_BASE_URL ?? 'http://127.0.0.1:8787'
}

/**
 * Map a logical URL to a FastAdmin entry point.
 *   /admin/...     → /admin.php/...        (admin module has its own entry)
 *   /api/...       → /api/... unchanged    (api module via index.php auto-routing)
 *   /index/...     → /index/... unchanged  (front-end module)
 *   /<other>       → unchanged (already a full path)
 */
export function resolveUrl(input: string): string {
  if (input.startsWith('/admin/')) {
    return '/admin.php/' + input.slice('/admin/'.length)
  }
  if (input === '/admin') return '/admin.php'
  return input
}

export function createHttpClient(opts: { baseURL?: string } = {}): HttpClient {
  const baseURL = opts.baseURL ?? defaultBaseURL()
  const jar = new CookieJar()
  const client = wrapper(axios.create({
    baseURL,
    jar,
    withCredentials: true,
    validateStatus: () => true,         // we'll inspect status ourselves
    maxRedirects: 0,                    // tests inspect redirects explicitly
    timeout: 15_000,
  }))

  let token: string | null = null

  async function request<T = unknown>(o: RequestOptions): Promise<RawResponse<T>> {
    const method = (o.method ?? 'GET').toUpperCase() as Method
    const url = resolveUrl(o.url)
    const headers: Record<string, string> = { ...(o.headers ?? {}) }
    // X-Requested-With: XHR opts into FastAdmin's ajax response path. Default off
    // so GET HTML stays HTML; helpers .json() / .html() override per their semantics.
    if (o.ajax === true) headers['X-Requested-With'] = 'XMLHttpRequest'
    if (token) headers['token'] = token

    let data: unknown = undefined
    if (o.json) {
      data = o.json
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
    } else if (o.multipart) {
      data = o.multipart
      Object.assign(headers, (o.multipart as unknown as { getHeaders(): Record<string, string> }).getHeaders())
    } else if (o.form) {
      data = new URLSearchParams(
        Object.entries(o.form).map(([k, v]) => [k, v == null ? '' : String(v)]),
      ).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const res: AxiosResponse = await client.request({
      method,
      url,
      params: o.query,
      data,
      headers,
      // Get the raw response as ArrayBuffer; we decode and decide JSON vs HTML ourselves.
      // Both `responseType: 'text'` + `transformResponse: [identity]` are needed to fully
      // disable axios's default JSON parsing/stringifying chain.
      responseType: 'arraybuffer',
      transformResponse: [(d) => d],
    })

    const raw: string = Buffer.isBuffer(res.data)
      ? res.data.toString('utf8')
      : typeof res.data === 'string'
        ? res.data
        : res.data instanceof ArrayBuffer
          ? Buffer.from(res.data).toString('utf8')
          : String(res.data ?? '')
    let body: Envelope<T> | string = raw
    if (raw.length > 0 && (raw[0] === '{' || raw[0] === '[')) {
      try {
        body = JSON.parse(raw) as Envelope<T>
      } catch {
        body = raw
      }
    }

    const flatHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(res.headers)) {
      if (typeof v === 'string') flatHeaders[k.toLowerCase()] = v
      else if (Array.isArray(v)) flatHeaders[k.toLowerCase()] = v.join(', ')
    }
    return { status: res.status, headers: flatHeaders, body }
  }

  async function json<T = unknown>(o: RequestOptions): Promise<Envelope<T>> {
    // JSON endpoints in admin/index modules expect ajax mode to return clean JSON
    // rather than a redirect-flavoured HTML jump page on success/error.
    const r = await request<T>({ ...o, ajax: o.ajax ?? true })
    if (typeof r.body === 'string') {
      throw new Error(`expected JSON response from ${o.url}, got string (status ${r.status}): ${r.body.slice(0, 200)}`)
    }
    return r.body
  }

  async function html(o: RequestOptions): Promise<string> {
    const r = await request({ ...o, ajax: o.ajax ?? false })
    if (typeof r.body !== 'string') {
      throw new Error(`expected HTML response from ${o.url}, got JSON envelope`)
    }
    return r.body
  }

  async function fetchToken(formUrl: string): Promise<string> {
    const body = await html({ method: 'GET', url: formUrl })
    const m = /name=["']__token__["'][^>]*value=["']([a-f0-9]{20,})["']/i.exec(body)
        ?? /value=["']([a-f0-9]{20,})["'][^>]*name=["']__token__["']/i.exec(body)
    if (!m) throw new Error(`__token__ not found in form ${formUrl}`)
    return m[1]!
  }

  function getCookie(name: string): string | undefined {
    const cookies = jar.getCookiesSync(baseURL)
    return cookies.find((c) => c.key === name)?.value
  }

  function clearCookies(): void {
    jar.removeAllCookiesSync()
  }

  return {
    request,
    json,
    html,
    fetchToken,
    setToken: (t) => { token = t },
    getToken: () => token,
    getCookie,
    clearCookies,
    baseURL,
    axios: client,
  }
}
