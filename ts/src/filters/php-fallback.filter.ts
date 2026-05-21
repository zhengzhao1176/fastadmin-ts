// PHP fallback exception filter.
//
// When a request arrives at NestJS that DOESN'T match any registered route,
// Nest throws NotFoundException and the default filter returns 404. The TS
// port deliberately doesn't reimplement every PHP feature (CMS addon, full
// command scheduler, SQL console, etc.) — for those routes we transparently
// forward the request to the original PHP server.
//
// Enabled only when `PHP_FALLBACK_HOST` is set in the env. In test/CI
// scenarios where the PHP container isn't running we leave the filter off so
// the 519 black-box tests still see deterministic 404s.
//
// Flow:
//   request → NestJS router  (matches?)
//                ├─ yes → TS controller serves it
//                └─ no  → NotFoundException
//                          └─ PhpFallbackFilter catches
//                              → http.request to PHP @ host:port
//                              → pipe response back (headers + body)
//
// Body forwarding: NestJS' body parser already consumed the request body;
// we re-serialize JSON / urlencoded form back so the proxied PHP request
// receives the same payload. Multipart uploads need raw-body access — out
// of scope for the first cut (PHP-only file uploads should hit the PHP
// server directly via a different domain or path prefix).
//
// Session sharing: this proxy forwards the `PHPSESSID` cookie unchanged, so
// if the user has logged in on the PHP side, that session carries over. The
// TS port's own admin session is independent (its own express-session). For
// a single sign-on experience the operator would need to share a session
// store between the two — out of scope for the fallback.
import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common'
import type { Request, Response } from 'express'
import http from 'node:http'
import { URLSearchParams } from 'node:url'

/** PHP fallback target — read once at construction. */
function readTarget(): { host: string; port: number } | null {
  const host = process.env.PHP_FALLBACK_HOST
  if (!host) return null
  const port = Number(process.env.PHP_FALLBACK_PORT ?? '8787')
  return { host, port: Number.isFinite(port) && port > 0 ? port : 8787 }
}

/** Hop-by-hop headers per RFC 7230 § 6.1 — must not be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

@Catch(NotFoundException)
export class PhpFallbackFilter implements ExceptionFilter {
  private readonly target = readTarget()

  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const req = ctx.getRequest<Request>()
    const res = ctx.getResponse<Response>()

    // Fallback disabled — preserve the original 404 behaviour.
    if (!this.target) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') res.status(status).send(body)
      else res.status(status).json(body)
      return
    }

    // Build the proxy request. Forward path + query + method + headers.
    const incomingHeaders = { ...req.headers }
    // Override host so PHP's vhost dispatch routes correctly (it expects its
    // own host:port, not the upstream's).
    delete incomingHeaders['content-length'] // we re-encode body, length will be re-derived
    for (const h of Object.keys(incomingHeaders)) {
      if (HOP_BY_HOP.has(h.toLowerCase())) delete incomingHeaders[h]
    }
    incomingHeaders['host'] = `${this.target.host}:${this.target.port}`
    // Identifying header so PHP-side logs can trace fallback hits.
    incomingHeaders['x-forwarded-by'] = 'fastadmin-ts-php-fallback'

    // Reconstruct body for re-POST. body-parser already consumed the stream.
    let payload: string | Buffer | undefined
    let payloadContentType = String(incomingHeaders['content-type'] ?? '')
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      const ct = payloadContentType.toLowerCase()
      if (ct.includes('application/json')) {
        payload = JSON.stringify(req.body)
      } else if (ct.includes('application/x-www-form-urlencoded') || (typeof req.body === 'object' && req.body)) {
        // Default to urlencoded for typical form posts.
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
          appendFormValue(params, k, v)
        }
        payload = params.toString()
        if (!ct.includes('application/x-www-form-urlencoded')) {
          payloadContentType = 'application/x-www-form-urlencoded'
          incomingHeaders['content-type'] = payloadContentType
        }
      }
    }
    if (payload !== undefined) {
      incomingHeaders['content-length'] = String(Buffer.byteLength(payload))
    }

    const options: http.RequestOptions = {
      host: this.target.host,
      port: this.target.port,
      path: req.originalUrl ?? req.url ?? '/',
      method: req.method,
      headers: incomingHeaders,
      timeout: 15_000,
    }

    const proxyReq = http.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode ?? 502)
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v === undefined) continue
        if (HOP_BY_HOP.has(k.toLowerCase())) continue
        // Replace, don't append — PHP may set the same header twice (e.g.
        // Set-Cookie returns an array which Express handles correctly).
        res.setHeader(k, v as string | string[])
      }
      proxyRes.pipe(res)
    })

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('PHP fallback timeout'))
    })

    proxyReq.on('error', (err) => {
      if (res.headersSent) return
      res.status(502).json({
        code: 0,
        msg: `PHP fallback unavailable: ${err.message}`,
        data: null,
      })
    })

    if (payload !== undefined) proxyReq.write(payload)
    proxyReq.end()
  }
}

/**
 * URL-encoded form serialisation. body-parser's "extended: true" produces
 * nested objects (e.g. `row[name]` → `{row: {name: ...}}`); to re-encode for
 * PHP we walk back to the bracket notation.
 */
function appendFormValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const v of value) appendFormValue(params, `${key}[]`, v)
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendFormValue(params, `${key}[${k}]`, v)
    }
    return
  }
  params.append(key, String(value))
}
