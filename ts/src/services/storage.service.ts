// Pluggable storage backend. Default = local FS (matches PHP `upload.storage =
// local`). Cloud providers register via `storage.register(adapter)` from
// addons (e.g. aliyun-oss, qiniu, aws-s3).
//
// Driver selection is env-gated via `STORAGE_DRIVER`:
//   - unset / `local` → LocalStorageAdapter  (default; behaviour unchanged)
//   - `s3`            → S3StorageAdapter     (any S3-compatible endpoint:
//                       AWS S3, MinIO, Aliyun OSS, Qiniu Kodo S3 gateway,
//                       Tencent COS S3-compatible — all speak the same
//                       SigV4-signed REST PUT)
import { Injectable } from '@nestjs/common'
import crypto from 'node:crypto'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads')

export interface StorageSaveResult {
  url: string         // public URL relative to /uploads/, e.g. /uploads/202506/<sha1>.png
  fullurl: string     // absolute URL (may include cdn host)
}

export interface StorageAdapter {
  name: string
  save(buffer: Buffer, key: string, mimetype: string): Promise<StorageSaveResult>
  delete(url: string): Promise<void>
}

/** Default: writes under `ts/uploads/<yyyymm>/<sha1>.<ext>`. */
export class LocalStorageAdapter implements StorageAdapter {
  name = 'local'

  async save(buffer: Buffer, key: string, _mimetype: string): Promise<StorageSaveResult> {
    const dir = path.dirname(path.join(UPLOAD_ROOT, key))
    fs.mkdirSync(dir, { recursive: true })
    const full = path.join(UPLOAD_ROOT, key)
    fs.writeFileSync(full, buffer)
    const url = '/uploads/' + key
    return { url, fullurl: url }
  }

  async delete(url: string): Promise<void> {
    const rel = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : url
    const full = path.join(UPLOAD_ROOT, rel)
    if (fs.existsSync(full)) fs.unlinkSync(full)
  }
}

// --------------------------------------------------------------------------
// AWS Signature V4 — zero-dependency, implemented with node:crypto.
//
// Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
// One signer covers AWS S3 and every S3-compatible store (MinIO, Aliyun OSS,
// Qiniu, Tencent COS) because they all accept the same canonical request +
// `Authorization: AWS4-HMAC-SHA256 …` header.
// --------------------------------------------------------------------------

const SERVICE = 's3'
const ALGORITHM = 'AWS4-HMAC-SHA256'
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

export interface SigV4Input {
  method: string
  /** Endpoint host only, e.g. `s3.us-east-1.amazonaws.com` or `oss-cn-hangzhou.aliyuncs.com`. */
  host: string
  /** Object path beginning with `/`, e.g. `/my-bucket/202506/abc.png`. */
  canonicalUri: string
  region: string
  accessKey: string
  secretKey: string
  /** Sha256 hex of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string
  /** Extra headers to sign (lower-cased keys); `host` and `x-amz-*` added automatically. */
  headers?: Record<string, string>
  /** Override request time — used by tests for a deterministic signature. */
  now?: Date
}

export interface SigV4Result {
  /** Headers to attach to the outgoing request (includes `Authorization`). */
  headers: Record<string, string>
  /** Intermediate values, exposed for unit testing the signer. */
  canonicalRequest: string
  stringToSign: string
  signature: string
  amzDate: string
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

/** Percent-encode per RFC 3986 (S3 canonical URI rules; `/` kept unescaped). */
function uriEncode(str: string, keepSlash: boolean): string {
  let out = ''
  for (const ch of Buffer.from(str, 'utf8')) {
    const c = String.fromCharCode(ch)
    if (
      (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
      c === '-' || c === '_' || c === '.' || c === '~' || (keepSlash && c === '/')
    ) {
      out += c
    } else {
      out += '%' + ch.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

/**
 * Produce an AWS SigV4 `Authorization` header (and the `x-amz-*` headers it
 * covers) for a single S3 request. Pure function — no I/O — so it is unit
 * testable against AWS's published test vectors.
 */
export function signV4(input: SigV4Input): SigV4Result {
  const now = input.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260521T120000Z
  const dateStamp = amzDate.slice(0, 8)                          // 20260521

  // Assemble the full header set that will be signed.
  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  }
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    headers[k.toLowerCase()] = v
  }

  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames
    .map((k) => `${k}:${headers[k]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    uriEncode(input.canonicalUri, true),
    '', // canonical query string (none — object PUT/DELETE use path only)
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  // Derive the signing key: HMAC chain over date → region → service → request.
  const kDate = hmac('AWS4' + input.secretKey, dateStamp)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization =
    `${ALGORITHM} Credential=${input.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    headers: { ...headers, Authorization: authorization },
    canonicalRequest,
    stringToSign,
    signature,
    amzDate,
  }
}

export interface S3Config {
  endpoint: string   // e.g. https://s3.us-east-1.amazonaws.com  or  https://oss-cn-hangzhou.aliyuncs.com
  bucket: string
  region: string
  accessKey: string
  secretKey: string
}

/** Read S3 config from env. Returns null when not fully configured. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const endpoint = env.STORAGE_S3_ENDPOINT
  const bucket = env.STORAGE_S3_BUCKET
  const region = env.STORAGE_S3_REGION
  const accessKey = env.STORAGE_S3_KEY
  const secretKey = env.STORAGE_S3_SECRET
  if (!endpoint || !bucket || !region || !accessKey || !secretKey) return null
  return { endpoint, bucket, region, accessKey, secretKey }
}

/**
 * S3-compatible object storage. PUTs objects to any endpoint that speaks the
 * S3 REST API with SigV4 — covers AWS S3, MinIO, Aliyun OSS, Qiniu Kodo's S3
 * gateway and Tencent COS. Uses path-style addressing (`<endpoint>/<bucket>/<key>`),
 * the most portable form across vendors.
 *
 * Constructed lazily by `StorageService` only when `STORAGE_DRIVER=s3`; if env
 * is incomplete it stays a stub and `save()` throws a clear message.
 */
export class S3StorageAdapter implements StorageAdapter {
  name = 's3'
  private readonly config: S3Config | null

  constructor(config: S3Config | null = s3ConfigFromEnv()) {
    this.config = config
  }

  /** True when credentials/bucket are present and uploads will be attempted. */
  get configured(): boolean {
    return this.config !== null
  }

  /** Path-style object URL: `<endpoint>/<bucket>/<key>`. */
  objectUrl(key: string): string {
    if (!this.config) throw new Error('S3 storage not configured.')
    const base = this.config.endpoint.replace(/\/+$/, '')
    return `${base}/${this.config.bucket}/${key.replace(/^\/+/, '')}`
  }

  async save(buffer: Buffer, key: string, mimetype: string): Promise<StorageSaveResult> {
    const cfg = this.config
    if (!cfg) {
      throw new Error(
        'S3 storage not configured. Set STORAGE_S3_ENDPOINT / STORAGE_S3_BUCKET / ' +
        'STORAGE_S3_REGION / STORAGE_S3_KEY / STORAGE_S3_SECRET.',
      )
    }
    const cleanKey = key.replace(/^\/+/, '')
    const target = new URL(this.objectUrl(cleanKey))
    const contentType = mimetype || 'application/octet-stream'

    const signed = signV4({
      method: 'PUT',
      host: target.host,
      canonicalUri: target.pathname,
      region: cfg.region,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      payloadHash: sha256Hex(buffer),
      headers: { 'content-type': contentType },
    })

    await this.request('PUT', target, {
      ...signed.headers,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
    }, buffer)

    const fullurl = target.toString()
    return { url: fullurl, fullurl }
  }

  async delete(url: string): Promise<void> {
    const cfg = this.config
    if (!cfg) throw new Error('S3 storage not configured.')
    // Accept either a full object URL or a bare key.
    const target = /^https?:\/\//.test(url) ? new URL(url) : new URL(this.objectUrl(url))

    const signed = signV4({
      method: 'DELETE',
      host: target.host,
      canonicalUri: target.pathname,
      region: cfg.region,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      payloadHash: UNSIGNED_PAYLOAD,
    })

    await this.request('DELETE', target, signed.headers)
  }

  /** Thin HTTP(S) request helper — resolves on 2xx, rejects with body on error. */
  private request(
    method: string,
    target: URL,
    headers: Record<string, string>,
    body?: Buffer,
  ): Promise<void> {
    const transport = target.protocol === 'http:' ? http : https
    return new Promise<void>((resolve, reject) => {
      const req = transport.request(
        {
          method,
          hostname: target.hostname,
          port: target.port || undefined,
          path: target.pathname + target.search,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            const status = res.statusCode ?? 0
            if (status >= 200 && status < 300) {
              resolve()
            } else {
              const detail = Buffer.concat(chunks).toString('utf8').slice(0, 500)
              reject(new Error(`S3 ${method} ${target.host} failed: HTTP ${status} ${detail}`))
            }
          })
        },
      )
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }
}

@Injectable()
export class StorageService {
  private adapters = new Map<string, StorageAdapter>()
  private currentName: string

  constructor() {
    this.register(new LocalStorageAdapter())
    this.register(new S3StorageAdapter())

    // Driver selection — env-gated. Unset → `local` (behaviour unchanged).
    const driver = (process.env.STORAGE_DRIVER ?? 'local').trim().toLowerCase()
    this.currentName = this.adapters.has(driver) ? driver : 'local'
  }

  register(adapter: StorageAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  use(name: string): StorageAdapter {
    const a = this.adapters.get(name)
    if (!a) throw new Error(`Storage adapter not registered: ${name}`)
    return a
  }

  /** Switch the default adapter (called by config reload when `upload.storage` changes). */
  setCurrent(name: string): void {
    if (!this.adapters.has(name)) throw new Error(`Storage adapter not registered: ${name}`)
    this.currentName = name
  }

  current(): StorageAdapter { return this.use(this.currentName) }
}
