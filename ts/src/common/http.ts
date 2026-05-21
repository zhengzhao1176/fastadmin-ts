// Port of `fast\Http` from extend/fast/Http.php — a tiny HTTP client.
// PHP uses cURL; here we wrap Node 18+'s global `fetch`. Covers GET/POST
// with form-urlencoded or JSON bodies and a request timeout.

/** Options accepted by every request helper. */
export interface HttpOptions {
  /** Extra request headers. */
  headers?: Record<string, string>
  /** Abort the request after this many milliseconds (default 10000). */
  timeout?: number
  /** Query-string parameters appended to the URL. */
  query?: Record<string, string | number | boolean>
}

/** Normalised response returned by every helper. */
export interface HttpResponse {
  status: number
  body: string
  headers: Record<string, string>
}

const DEFAULT_TIMEOUT = 10000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.98 Safari/537.36'

/** Serialise a plain object to an `application/x-www-form-urlencoded` string. */
function buildQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    usp.append(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  return usp.toString()
}

/** Append `query` params to a URL, preserving any existing query string. */
function withQuery(url: string, query?: HttpOptions['query']): string {
  if (!query || Object.keys(query).length === 0) return url
  const qs = buildQuery(query)
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

/** Run a fetch with a timeout and normalise the response shape. */
async function doFetch(
  url: string,
  init: RequestInit,
  timeout: number,
): Promise<HttpResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    return { status: res.status, body, headers }
  } finally {
    clearTimeout(timer)
  }
}

/** Send a GET request. */
export function get(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  return doFetch(
    withQuery(url, opts.query),
    {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, ...opts.headers },
      redirect: 'follow',
    },
    opts.timeout ?? DEFAULT_TIMEOUT,
  )
}

/**
 * Send a POST request. `data` is sent as `application/x-www-form-urlencoded`
 * when it's an object, or verbatim when it's a string.
 */
export function post(
  url: string,
  data: Record<string, unknown> | string = {},
  opts: HttpOptions = {},
): Promise<HttpResponse> {
  const isString = typeof data === 'string'
  const body = isString ? data : buildQuery(data)
  return doFetch(
    withQuery(url, opts.query),
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...opts.headers,
      },
      body,
      redirect: 'follow',
    },
    opts.timeout ?? DEFAULT_TIMEOUT,
  )
}

/** Send a POST request with a JSON body (`application/json`). */
export function postJson(
  url: string,
  obj: unknown,
  opts: HttpOptions = {},
): Promise<HttpResponse> {
  return doFetch(
    withQuery(url, opts.query),
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
      body: JSON.stringify(obj),
      redirect: 'follow',
    },
    opts.timeout ?? DEFAULT_TIMEOUT,
  )
}

/** Result shape of `sendRequest` — mirrors PHP `\fast\Http::sendRequest`. */
export interface SendResult {
  /** true for a 2xx response; false on a non-2xx status or a network error. */
  ret: boolean
  /** response body on success, or the error message on failure. */
  msg: string
  /** HTTP status code (0 when the request never completed). */
  httpcode: number
  /** the raw response body ('' on a network error). */
  body: string
}

/**
 * `\fast\Http::sendRequest()` — fire a GET/POST and report the outcome in a
 * single `{ ret, msg, httpcode, body }` envelope. Network failures resolve
 * (they do not throw) with `ret:false`, matching the PHP helper's contract.
 */
export async function sendRequest(
  url: string,
  params: Record<string, unknown> = {},
  method = 'POST',
  opts: HttpOptions = {},
): Promise<SendResult> {
  try {
    const m = String(method).toUpperCase()
    const res = m === 'GET'
      ? await get(withQuery(url, params as HttpOptions['query']), opts)
      : await post(url, params, opts)
    return {
      ret: res.status >= 200 && res.status < 300,
      msg: res.body,
      httpcode: res.status,
      body: res.body,
    }
  } catch (e) {
    return { ret: false, msg: (e as Error).message, httpcode: 0, body: '' }
  }
}

/** OOP-style facade matching PHP's `\fast\Http`. */
export const Http = { get, post, postJson, sendRequest }
