// admin/Ajax — utility endpoints: lang/upload/weigh/wipecache/category/area/icon.
// Mirrors application/admin/controller/Ajax.php. `lang` is on $noNeedLogin so it
// runs without the guard; the rest require an admin session.
import {
  All,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import type { Request, Response } from 'express'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { CategoryEntity } from '../../entities/category.entity.ts'
import { UploadService } from '../../services/upload.service.ts'
import { CacheService } from '../../services/cache.service.ts'
import { I18nService } from '../../services/i18n.service.ts'
import { HookService } from '../../services/hook.service.ts'

type MulterFile = { buffer: Buffer; originalname: string; mimetype: string; size: number }

interface AjaxReq extends Request {
  session?: { admin?: { id: number; username: string } } & Record<string, unknown>
}

const ALLOWED_LANGS = new Set(['zh-cn', 'en'])

// ---- /lang sub-controller (no auth required) -----------------------------
@Controller('admin.php/ajax')
export class AdminAjaxLangController {
  constructor(private readonly i18n: I18nService) {}

  @Get('lang')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  lang(@Query() q: Record<string, string>): string {
    const callback = String(q.callback ?? 'define').replace(/[^a-zA-Z0-9_]/g, '') || 'define'
    const controllername = String(q.controllername ?? '')
    const lang = String(q.lang ?? '')
    if (!lang || !ALLOWED_LANGS.has(lang) || !controllername || !/^[a-z0-9_.]+$/i.test(controllername)) {
      return `${callback}({"errmsg":"参数错误"});`
    }
    const dict = this.i18n.load(lang, 'admin', controllername)
    return `${callback}(${JSON.stringify(dict)});`
  }
}

// ---- main /ajax controller (requires admin session) ----------------------
@Controller('admin.php/ajax')
@UseGuards(AdminAuthGuard)
export class AdminAjaxController {
  constructor(
    @InjectRepository(CategoryEntity) private readonly cats: Repository<CategoryEntity>,
    private readonly dataSource: DataSource,
    private readonly upload: UploadService,
    private readonly cache: CacheService,
    private readonly hooks: HookService,
  ) {}

  // -------- upload: plain single-file OR chunked (chunk store + merge). --------
  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async uploadPost(
    @Req() req: AjaxReq,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    const userId = req.session?.admin?.id ?? 0

    // Chunked upload path. The dropzone client first POSTs each chunk (with a
    // `file` part), then issues a final `action=merge` request to assemble them.
    const chunkid = body['chunkid'] != null ? String(body['chunkid']) : ''
    if (chunkid) {
      // `chunking` config gate (doc 177) — addons / config can disable it.
      if (!this.upload.config().chunking) return adminErr('Chunk file disabled')
      const isMerge = String(body['action'] ?? '') === 'merge' || !file
      if (isMerge) {
        const chunkcount = parseInt(String(body['chunkcount'] ?? '0'), 10)
        const filename = String(body['filename'] ?? body['chunkfilename'] ?? 'merged.bin')
        const merged = await this.upload.mergeChunks(chunkid, chunkcount, filename, userId)
        if (!merged.ok) return adminErr(merged.error ?? 'Upload failed')
        const host = req.protocol + '://' + (req.get('host') ?? '127.0.0.1')
        await this.hooks.listen('upload_after', { url: merged.url, fullurl: host + merged.url, userId })
        return adminOk('Uploaded successful', { url: merged.url, fullurl: host + merged.url })
      }
      // Store a single chunk — no url yet, the merge step produces it.
      const chunkindex = parseInt(String(body['chunkindex'] ?? '0'), 10)
      try {
        await this.upload.saveChunk(chunkid, chunkindex, file.buffer)
      } catch (e) {
        return adminErr((e as Error).message)
      }
      return adminOk('')
    }

    if (!file) return adminErr('No file uploaded')
    const result = await this.upload.save({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      userId,
    })
    if (!result.ok) {
      const msg = result.error === 'mimetype_denied'
        ? 'File extension is not allowed'
        : result.error === 'size_exceeded'
          ? 'File size exceeds the allowed limit'
          : 'Upload failed'
      return adminErr(msg)
    }
    const host = req.protocol + '://' + (req.get('host') ?? '127.0.0.1')
    // `upload_after` hook (doc 174) — addons can post-process the uploaded
    // file (e.g. push to cloud storage, generate extra thumbnails).
    await this.hooks.listen('upload_after', { url: result.url, fullurl: host + result.url, userId })
    return adminOk('Uploaded successful', { url: result.url, fullurl: host + result.url })
  }

  // -------- weigh: permute the `field` (default 'weigh') across ids. --------
  // Honours optional `pid` filter (only siblings within the same parent
  // participate) and `orderway` (asc/desc) so the front-end widget's "drag
  // within group" gesture is faithfully reflected in the DB.
  @Post('weigh')
  @HttpCode(200)
  async weigh(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const idsCsv = String(body['ids'] ?? '')
    const table = String(body['table'] ?? '')
    if (!table || !/^[a-zA-Z0-9_-]+$/.test(table)) return adminErr('Invalid table')
    const fieldRaw = String(body['field'] ?? 'weigh')
    const field = ['weigh'].includes(fieldRaw) ? fieldRaw : 'weigh'
    const pk = 'id'
    const orderway = String(body['orderway'] ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    let ids = idsCsv.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (ids.length === 0) return adminErr('No rows to reorder')

    const fullTable = `fa_${table}`

    // Optional pid scoping — keep only ids whose pid matches the supplied filter.
    const pidRaw = body['pid']
    if (pidRaw !== undefined && pidRaw !== '' && pidRaw !== null) {
      const pid = parseInt(String(pidRaw), 10) || 0
      const same = await this.dataSource.query(
        `SELECT \`${pk}\` FROM \`${fullTable}\` WHERE \`${pk}\` IN (?) AND pid = ?`,
        [ids, pid],
      ) as Array<Record<string, number | string>>
      const keep = new Set(same.map((r) => Number(r[pk])))
      ids = ids.filter((id) => keep.has(id))
      if (ids.length === 0) return adminErr('No rows to reorder')
    }

    // Pull current weighs.
    const rows = await this.dataSource.query(
      `SELECT \`${pk}\`, \`${field}\` FROM \`${fullTable}\` WHERE \`${pk}\` IN (?) ORDER BY \`${field}\` ${orderway}`,
      [ids],
    ) as Array<Record<string, number | string>>
    if (rows.length === 0) return adminErr('No rows to reorder')
    const weighs = rows.map((r) => Number(r[field]))
    // Assign in order of the supplied CSV.
    let count = 0
    for (let i = 0; i < ids.length && i < weighs.length; i++) {
      const res = await this.dataSource.query(
        `UPDATE \`${fullTable}\` SET \`${field}\` = ? WHERE \`${pk}\` = ?`,
        [weighs[i], ids[i]],
      ) as { affectedRows?: number }
      count += res?.affectedRows ?? 0
    }
    return adminOk('', { count })
  }

  // -------- wipecache: clear application/runtime caches based on `type`. --------
  // `type=all`      → everything
  // `type=content`  → keys with prefix `content:`
  // `type=template` → keys with prefix `template:`
  // `type=addons`   → keys with prefix `addons:`
  // (matches the PHP fall-through-switch behavior — unknown type is a no-op.)
  // PHP backend.js fires this via $.ajax with no `method` set → defaults to
  // GET. The legacy controller in PHP accepted both, so we mirror that.
  @All('wipecache')
  @HttpCode(200)
  async wipecache(
    @Body() body: Record<string, unknown> | undefined,
    @Query() query: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const type = String((body && body['type']) ?? query['type'] ?? '')
    try {
      if (type === 'all') await this.cache.clear()
      else if (type === 'content') await this.cache.clear('content:')
      else if (type === 'template') await this.cache.clear('template:')
      else if (type === 'addons') await this.cache.clear('addons:')
      // `wipecache_after` hook (doc 174) — addons can flush their own caches.
      await this.hooks.listen('wipecache_after', { type })
      // Unknown/empty type: still return success (matches PHP's switch fall-through).
      return adminOk('', { driver: this.cache.driver() })
    } catch (e) {
      return adminErr((e as Error).message)
    }
  }

  // -------- category: list categories of given type/pid. --------
  @Get('category')
  async category(@Query() q: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const type = q.type != null ? String(q.type) : ''
    const pid = q.pid
    const qb = this.cats.createQueryBuilder('c').where('c.status = :s', { s: 'normal' })
    if (pid != null && String(pid) !== '') qb.andWhere('c.pid = :pid', { pid: Number(pid) })
    if (type) qb.andWhere('c.type = :t', { t: type })
    qb.orderBy('c.weigh', 'DESC').addOrderBy('c.id', 'DESC')
    qb.select(['c.id AS value', 'c.name AS name'])
    const list = await qb.getRawMany()
    return adminOk('', list)
  }

  // -------- area: drill from province → city → county. --------
  @Get('area')
  async area(@Query() q: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const row = (q.row as Record<string, unknown> | undefined) ?? {}
    const province = row.province ?? q.province
    const city = row.city ?? q.city
    let where: { pid: number; level: number } = { pid: 0, level: 1 }
    if (province != null) {
      where = { pid: Number(province), level: 2 }
      if (city != null) where = { pid: Number(city), level: 3 }
    }
    let list: Array<{ value: number; name: string }> = []
    try {
      list = await this.dataSource.query(
        'SELECT id AS value, name FROM `fa_area` WHERE pid = ? AND level = ?',
        [where.pid, where.level],
      ) as Array<{ value: number; name: string }>
    } catch {
      // fa_area may be empty / missing in some installs — return [].
      list = []
    }
    return adminOk('', list)
  }

  // -------- icon: trivial SVG with the suffix label. --------
  @Get('icon')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public')
  icon(@Query('suffix') suffixQ?: string): string {
    const suffix = String(suffixQ ?? 'FILE').replace(/[^A-Z0-9a-z]/g, '').slice(0, 8) || 'FILE'
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="6" fill="#eee" />
  <text x="32" y="36" text-anchor="middle" font-size="14" fill="#333" font-family="sans-serif">${suffix}</text>
</svg>`
  }
}
