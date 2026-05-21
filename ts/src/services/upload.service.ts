import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AttachmentEntity } from '../entities/attachment.entity.ts'

// Mirrors application/common/library/Upload.php — minimum subset to handle
// the four upload tests: blacklist check, ok-path persists fa_attachment row,
// returns {url, fullurl}.
//
// Blacklist matches PHP's default upload.mimetype/extension blacklist:
//   php / phtml / pht / exe / sh / bat / jsp / asp / cgi / pl
const BLOCKED_EXTS = new Set([
  'php', 'phtml', 'pht', 'php3', 'php4', 'php5',
  'exe', 'bat', 'cmd', 'sh',
  'jsp', 'asp', 'aspx', 'cgi', 'pl',
])

const UPLOAD_ROOT = path.resolve(import.meta.dirname ?? '.', '../../uploads')

// Per-file chunk staging area. Mirrors PHP FastAdmin's RUNTIME_PATH/chunks/.
// `npm start` runs with cwd = ts/, so this resolves to ts/runtime/chunks/.
const CHUNK_ROOT = path.resolve(process.cwd(), 'runtime', 'chunks')

export interface UploadInput {
  buffer: Buffer
  filename: string
  mimetype: string
  userId: number
}

export interface UploadResult {
  ok: boolean
  url?: string
  fullurl?: string
  error?: 'no_file' | 'mimetype_denied' | 'write_failed' | 'size_exceeded'
}

/** Upload settings — mirrors FastAdmin `application/extra/upload.php` (doc 177). */
export interface UploadConfig {
  /** Storage path template with `{year}`/`{filemd5}`/… variables. */
  savekey: string
  /** Human file-size cap, e.g. `10mb`. With chunking on it caps a single chunk. */
  maxsize: string
  /** Allowed extension / mimetype list, or `*` for any (blacklist still applies). */
  mimetype: string
  /** Whether chunked upload is accepted. */
  chunking: boolean
  /** Chunk size in bytes. */
  chunksize: number
}

/**
 * Build the upload config from env, falling back to FastAdmin's documented
 * defaults. `mimetype` defaults to `*` (not PHP's image-only list) so the
 * shared `ajax/upload` endpoint stays general-purpose — the executable
 * blacklist still applies regardless.
 */
function loadUploadConfig(): UploadConfig {
  const e = process.env
  const chunkRaw = e.UPLOAD_CHUNKING
  return {
    savekey: e.UPLOAD_SAVEKEY || '/uploads/{year}{mon}{day}/{filemd5}{.suffix}',
    maxsize: e.UPLOAD_MAXSIZE || '10mb',
    mimetype: e.UPLOAD_MIMETYPE || '*',
    chunking: chunkRaw == null ? true : (chunkRaw !== 'false' && chunkRaw !== '0'),
    chunksize: parseInt(e.UPLOAD_CHUNKSIZE || '2097152', 10) || 2097152,
  }
}

/** Parse a human file-size (`10mb` / `2mb` / `1kb` / `2097152`) into bytes. */
export function parseMaxsize(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i.exec(String(s ?? '').trim())
  if (!m) return 0
  const n = parseFloat(m[1]!)
  const unit = (m[2] ?? '').toLowerCase()
  const mult = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1
  return Math.floor(n * mult)
}

/**
 * Match a file's extension / mimetype against the `mimetype` allow-list
 * (doc 177). `*` or empty allows anything. List entries may be bare extensions
 * (`jpg`), full mimetypes (`application/zip`), or wildcards (`image/*`).
 */
export function mimetypeAllowed(ext: string, mimetype: string, allow: string): boolean {
  const a = String(allow ?? '*').trim()
  if (a === '' || a === '*') return true
  const e = String(ext ?? '').toLowerCase()
  const m = String(mimetype ?? '').toLowerCase()
  for (const itemRaw of a.split(',')) {
    const item = itemRaw.trim().toLowerCase()
    if (!item) continue
    if (item === e || item === m) return true
    if (item.endsWith('/*') && m.startsWith(item.slice(0, -1))) return true
  }
  return false
}

/**
 * Resolve a FastAdmin `savekey` template into a storage path (doc 177).
 * Supported variables: {year}{mon}{day}{hour}{min}{sec}{random}{random32}
 * {filename}{suffix}{.suffix}{filemd5} (plus a bonus {filesha1}).
 */
export function resolveSavekey(
  template: string,
  file: { name: string; ext: string; md5: string; sha1: string },
): string {
  const d = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const rnd = (chars: number): string =>
    crypto.randomBytes(Math.ceil(chars / 2)).toString('hex').slice(0, chars)
  const vars: Record<string, string> = {
    '{year}': String(d.getFullYear()),
    '{mon}': p2(d.getMonth() + 1),
    '{day}': p2(d.getDate()),
    '{hour}': p2(d.getHours()),
    '{min}': p2(d.getMinutes()),
    '{sec}': p2(d.getSeconds()),
    '{random}': rnd(16),
    '{random32}': rnd(32),
    '{filename}': file.name,
    '{suffix}': file.ext || 'file',
    '{.suffix}': file.ext ? '.' + file.ext : '.file',
    '{filemd5}': file.md5,
    '{filesha1}': file.sha1,
  }
  let out = template
  for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v)
  return out
}

@Injectable()
export class UploadService {
  private readonly cfg: UploadConfig = loadUploadConfig()

  constructor(
    @InjectRepository(AttachmentEntity) private readonly attachments: Repository<AttachmentEntity>,
  ) {
    if (!fs.existsSync(UPLOAD_ROOT)) {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
    }
  }

  /** The active upload config (savekey / maxsize / mimetype / chunking). */
  config(): UploadConfig {
    return this.cfg
  }

  async save(input: UploadInput): Promise<UploadResult> {
    return this.saveBuffer(input)
  }

  // Persist a complete file buffer: blacklist check, sha1, write to disk,
  // optional image thumbnail, INSERT fa_attachment. Shared by `save()` (plain
  // upload) and `mergeChunks()` (chunked upload).
  private async saveBuffer(input: UploadInput, opts: { skipMaxsize?: boolean } = {}): Promise<UploadResult> {
    if (!input.buffer || !input.filename) return { ok: false, error: 'no_file' }
    const ext = path.extname(input.filename).slice(1).toLowerCase()
    if (BLOCKED_EXTS.has(ext)) return { ok: false, error: 'mimetype_denied' }
    // mimetype allow-list (doc 177) — default '*' is permissive.
    if (!mimetypeAllowed(ext, input.mimetype, this.cfg.mimetype)) {
      return { ok: false, error: 'mimetype_denied' }
    }
    // maxsize (doc 177) — skipped for a merged chunk result (capped per-chunk).
    if (!opts.skipMaxsize) {
      const max = parseMaxsize(this.cfg.maxsize)
      if (max > 0 && input.buffer.length > max) return { ok: false, error: 'size_exceeded' }
    }

    const sha1 = crypto.createHash('sha1').update(input.buffer).digest('hex')
    const md5 = crypto.createHash('md5').update(input.buffer).digest('hex')
    // Resolve the on-disk path from the configured `savekey` template (doc 177).
    let url = resolveSavekey(this.cfg.savekey, { name: input.filename, ext, md5, sha1 })
    if (!url.startsWith('/')) url = '/' + url
    const rel = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : url.replace(/^\/+/, '')
    const out = path.join(UPLOAD_ROOT, rel)
    // Sandbox — a crafted savekey must never escape the uploads root.
    if (out !== UPLOAD_ROOT && !out.startsWith(UPLOAD_ROOT + path.sep)) {
      return { ok: false, error: 'write_failed' }
    }
    const dir = path.dirname(out)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    try {
      fs.writeFileSync(out, input.buffer)
    } catch {
      return { ok: false, error: 'write_failed' }
    }

    // For image uploads: probe dimensions + emit a thumbnail next to the
    // original. Mirrors PHP's Upload::image() — uses `sharp` (pure-JS image
    // pipeline). Sharp install can fail on older systems; we lazy-import and
    // swallow errors so non-image uploads are unaffected.
    let imagewidth = ''
    let imageheight = 0
    if ((input.mimetype || '').startsWith('image/')) {
      try {
        const { default: sharp } = await import('sharp')
        const meta = await sharp(input.buffer).metadata()
        imagewidth = String(meta.width ?? '')
        imageheight = Number(meta.height ?? 0)
        // Generate a 200px-wide thumbnail (preserves aspect).
        const thumbBuf = await sharp(input.buffer).resize({ width: 200, withoutEnlargement: true }).toBuffer()
        const base = path.basename(out, ext ? '.' + ext : '')
        const thumbPath = path.join(dir, base + '_thumb' + (ext ? '.' + ext : ''))
        fs.writeFileSync(thumbPath, thumbBuf)
      } catch {
        // sharp not available or unsupported image — skip thumbnail.
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const row = await this.attachments.save(this.attachments.create({
      url,
      imagewidth,
      imageheight,
      imageframes: 0,
      filesize: input.buffer.length,
      mimetype: input.mimetype || 'application/octet-stream',
      extparam: '',
      createtime: now,
      updatetime: now,
      uploadtime: now,
      storage: 'local',
      sha1,
      admin_id: 0,
      user_id: input.userId,
    }))
    void row
    return { ok: true, url, fullurl: url }
  }

  // Write one chunk of a chunked upload to runtime/chunks/<chunkid>/<index>.part.
  async saveChunk(chunkid: string, chunkindex: number, buffer: Buffer): Promise<void> {
    const id = this.safeChunkId(chunkid)
    if (!id || !Number.isInteger(chunkindex) || chunkindex < 0) {
      throw new Error('Invalid chunk parameters')
    }
    // maxsize caps a single chunk when chunking is on (doc 177).
    const max = parseMaxsize(this.cfg.maxsize)
    if (max > 0 && buffer.length > max) {
      throw new Error('Chunk exceeds the configured maxsize')
    }
    const dir = path.join(CHUNK_ROOT, id)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${chunkindex}.part`), buffer)
  }

  // Concatenate 0.part..(chunkcount-1).part in order, run the same save path
  // as a plain upload, then drop the per-chunkid staging dir.
  async mergeChunks(
    chunkid: string,
    chunkcount: number,
    filename: string,
    userId: number,
  ): Promise<{ ok: boolean; url?: string; fullurl?: string; error?: string }> {
    const id = this.safeChunkId(chunkid)
    if (!id) return { ok: false, error: 'Invalid chunkid' }
    if (!Number.isInteger(chunkcount) || chunkcount <= 0) {
      return { ok: false, error: 'Invalid chunkcount' }
    }
    const dir = path.join(CHUNK_ROOT, id)
    if (!fs.existsSync(dir)) return { ok: false, error: 'Chunk file not found' }

    const buffers: Buffer[] = []
    for (let i = 0; i < chunkcount; i++) {
      const part = path.join(dir, `${i}.part`)
      if (!fs.existsSync(part)) {
        return { ok: false, error: `Missing chunk ${i}` }
      }
      buffers.push(fs.readFileSync(part))
    }
    const merged = Buffer.concat(buffers)

    const result = await this.saveBuffer({
      buffer: merged,
      filename: filename || 'merged.bin',
      mimetype: 'application/octet-stream',
      userId,
    }, { skipMaxsize: true })
    // Drop the staging dir whether or not the save succeeded — the client must
    // re-upload chunks to retry, so stale parts are useless either way.
    fs.rmSync(dir, { recursive: true, force: true })

    if (!result.ok) {
      const msg = result.error === 'mimetype_denied'
        ? 'File extension is not allowed'
        : 'Upload failed'
      return { ok: false, error: msg }
    }
    return { ok: true, url: result.url, fullurl: result.fullurl }
  }

  // Constrain chunkid to a filesystem-safe token so a hostile value can't
  // escape CHUNK_ROOT. Matches the frontend's uuid format ([a-z0-9-]{36}).
  private safeChunkId(chunkid: string): string {
    return /^[a-zA-Z0-9_-]{1,64}$/.test(chunkid ?? '') ? chunkid : ''
  }
}
