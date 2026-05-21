// admin/general/Attachment — list/select/add/del/classify.
// Mirrors application/admin/controller/general/Attachment.php.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import type { Request } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { AttachmentEntity } from '../../entities/attachment.entity.ts'
import { ConfigEntity } from '../../entities/config.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { env } from '../../common/env.ts'
import { NoNeedRight } from '../../common/no-need-right.decorator.ts'
import { ViewService } from '../../services/view.service.ts'

type AttReq = Request & { session: SessionWithToken & { [k: string]: unknown } }

interface ListResponse {
  total: number
  rows: Array<Record<string, unknown>>
}

@Controller('admin.php/general/attachment')
@UseGuards(AdminAuthGuard)
@NoNeedRight(['classify'])
export class GeneralAttachmentController {
  constructor(
    @InjectRepository(AttachmentEntity) private readonly atts: Repository<AttachmentEntity>,
    @InjectRepository(ConfigEntity) private readonly configs: Repository<ConfigEntity>,
    private readonly view: ViewService,
    private readonly csrf: CsrfService,
  ) {}

  @Get('index')
  async indexGet(
    @Req() req: Request,
    @Query() q: Record<string, string>,
  ): Promise<unknown> {
    if (isAjax(req)) return this.listAjax(q)
    return this.renderListHtml(req)
  }

  @Get('select')
  async select(
    @Req() req: Request,
    @Query() q: Record<string, string>,
  ): Promise<unknown> {
    if (isAjax(req)) return this.listAjax(q)
    return this.renderListHtml(req)
  }

  @Get('add')
  async addGet(@Req() req: Request): Promise<unknown> {
    if (isAjax(req)) return adminErr('Direct ajax upload not supported here')
    return `<!doctype html><html><body><form id="upload"></form></body></html>`
  }

  // -------- edit. GET → form HTML, POST → UPDATE. --------
  @Get('edit/ids/:id')
  async getEdit(@Req() req: AttReq, @Param('id') idStr: string): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idStr, 10))
  }

  @Get('edit')
  async getEditQuery(@Req() req: AttReq, @Query('ids') idsQ?: string): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idsQ ?? '0', 10))
  }

  private async renderEditOrError(req: AttReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.atts.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    const categoryOptions = await this.buildCategoryOptions(row.category)
    const fields = buildAttachmentEditFormFields({ row, categoryOptions })
    return this.view.renderFormPage({
      pageTitle: 'Edit Attachment',
      formId: 'edit-form',
      formAction: `/admin.php/general/attachment/edit/ids/${row.id}`,
      __token__: tok,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'general.attachment',
      actionname: 'edit',
    })
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: AttReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.editImpl(req, parseInt(String(body['ids'] ?? '0'), 10), body)
  }

  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPath(
    @Req() req: AttReq,
    @Param('id') idStr: string,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.editImpl(req, parseInt(idStr, 10), body)
  }

  private async editImpl(
    req: AttReq,
    id: number,
    body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')
    const row = await this.atts.findOneBy({ id })
    if (!row) return adminErr('No Results were found')
    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('Parameter %s can not be empty')
    const r = rowParam as Record<string, unknown>
    const updateBag: Partial<AttachmentEntity> = {
      category: r.category != null ? String(r.category) : row.category,
      url: r.url != null ? String(r.url) : row.url,
      imagewidth: r.imagewidth != null ? String(r.imagewidth) : row.imagewidth,
      imageheight: r.imageheight != null ? Number(r.imageheight) : row.imageheight,
      imagetype: r.imagetype != null ? String(r.imagetype) : row.imagetype,
      imageframes: r.imageframes != null ? Number(r.imageframes) : row.imageframes,
      filesize: r.filesize != null ? Number(r.filesize) : row.filesize,
      mimetype: r.mimetype != null ? String(r.mimetype) : row.mimetype,
      extparam: r.extparam != null ? String(r.extparam) : row.extparam,
      admin_id: r.admin_id != null ? Number(r.admin_id) : row.admin_id,
      user_id: r.user_id != null ? Number(r.user_id) : row.user_id,
      updatetime: Math.floor(Date.now() / 1000),
    }
    await this.atts.update({ id }, updateBag)
    return adminOk('')
  }

  private async buildCategoryOptions(selected?: string): Promise<string> {
    const row = await this.configs.findOneBy({ name: 'attachmentcategory' })
    const items: Array<[string, string]> = []
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as Record<string, string>
        for (const [k, v] of Object.entries(parsed)) items.push([k, v])
      } catch { /* ignore */ }
    }
    const cur = String(selected ?? '')
    const out: string[] = [`<option value=""${cur === '' ? ' selected' : ''}>Please select category</option>`]
    for (const [k, label] of items) {
      const sel = k === cur ? ' selected' : ''
      out.push(`<option value="${escapeHtml(k)}"${sel}>${escapeHtml(label)}</option>`)
    }
    return out.join('\n')
  }

  private renderErrorHtml(req: AttReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'general.attachment',
      actionname: 'error',
    })
  }

  // -------- del (POST only). Physically remove files from disk. --------
  @Post('del')
  @HttpCode(200)
  async del(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (idArr.length === 0) return adminErr('Parameter %s can not be empty')
    const rows = await this.atts.find({ where: { id: In(idArr) } })
    for (const row of rows) {
      if (row.storage === 'local') {
        const abs = path.resolve(this.publicRoot(), '.' + row.url)
        if (fs.existsSync(abs)) {
          try { fs.unlinkSync(abs) } catch { /* ignore */ }
        }
      }
    }
    await this.atts.delete({ id: In(idArr) })
    return adminOk('')
  }

  @Get('del')
  delGet(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }

  // -------- classify (POST only). --------
  @Post('classify')
  @HttpCode(200)
  async classify(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    const categoryIn = body['category']
    if (categoryIn === undefined) return adminErr('Parameter %s can not be empty')
    if (!ids) return adminErr('Parameter %s can not be empty')

    const category = String(categoryIn)
    const allowed = await this.loadCategoryNames()
    // 'unclassed' is always implicit; empty string is allowed (means "clear").
    if (category !== '' && category !== 'unclassed' && !allowed.has(category)) {
      return adminErr('Category not found')
    }
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (idArr.length === 0) return adminErr('Parameter %s can not be empty')
    await this.atts.update({ id: In(idArr) }, { category: category === 'unclassed' ? '' : category })
    return adminOk('')
  }

  @Get('classify')
  classifyGet(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }

  // -------- internals --------
  private async listAjax(q: Record<string, string>): Promise<ListResponse> {
    const limit = Math.max(1, parseInt(String(q.limit ?? '10'), 10) || 10)
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
    const sort = String(q.sort ?? 'id')
    const order = (String(q.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC'
    const offset = (page - 1) * limit

    const search = String(q.search ?? '').trim()
    let filterRaw: unknown
    try { filterRaw = q.filter ? JSON.parse(String(q.filter)) : {} } catch { filterRaw = {} }
    const filter = (filterRaw && typeof filterRaw === 'object' ? filterRaw : {}) as Record<string, unknown>

    const qb = this.atts.createQueryBuilder('a')

    // search across id/filename/url
    if (search) {
      qb.andWhere('(a.filename LIKE :s OR a.url LIKE :s OR CAST(a.id AS CHAR) LIKE :s)', { s: `%${search}%` })
    }

    // mimetype wildcard handling: "image/*" → LIKE %image/% ; comma-list ORed.
    if (filter.mimetype != null) {
      const mt = String(filter.mimetype)
      if (/[/,*]/.test(mt)) {
        const terms = mt.split(',').map((t) => t.replace('/*', '/').trim()).filter(Boolean)
        if (terms.length > 0) {
          const orClauses: string[] = []
          const params: Record<string, unknown> = {}
          terms.forEach((term, i) => {
            params[`mt${i}`] = `%${term}%`
            orClauses.push(`a.mimetype LIKE :mt${i}`)
          })
          qb.andWhere(`(${orClauses.join(' OR ')})`, params)
        }
      } else {
        qb.andWhere('a.mimetype = :mt', { mt })
      }
    }

    // category handling: 'unclassed' means "no category filter at all" (matches PHP bug).
    if (filter.category != null && filter.category !== 'unclassed' && filter.category !== '') {
      qb.andWhere('a.category = :cat', { cat: filter.category })
    }

    // Other simple equality filters.
    for (const [k, v] of Object.entries(filter)) {
      if (['mimetype', 'category'].includes(k)) continue
      if (!/^[a-zA-Z0-9_]+$/.test(k)) continue
      qb.andWhere(`a.${k} = :f_${k}`, { [`f_${k}`]: v })
    }

    const total = await qb.getCount()
    if (/^[a-zA-Z0-9_]+$/.test(sort)) {
      qb.orderBy(`a.${sort}`, order)
    }
    qb.skip(offset).take(limit)
    const rows = await qb.getMany()
    const cdnurl = env('FASTADMIN_CDN_URL', '')
    const decorated = rows.map((r) => ({
      ...r,
      fullurl: (r.storage === 'local' ? cdnurl : cdnurl) + (r.url ?? ''),
    }))
    return { total, rows: decorated }
  }

  private renderListHtml(req: Request): string {
    return this.view.renderListPage({
      pageTitle: 'Attachment',
      tableId: 'table',
      indexUrl: '/admin.php/general/attachment/index',
      editUrl: '/admin.php/general/attachment/edit',
      delUrl: '/admin.php/general/attachment/del',
      req,
      controllername: 'general.attachment',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'url', title: 'URL', formatter: 'Table.api.formatter.image' },
        { field: 'imagewidth', title: 'Width' },
        { field: 'imageheight', title: 'Height' },
        { field: 'filesize', title: 'Size' },
        { field: 'mimetype', title: 'Mime' },
        { field: 'createtime', title: 'Time', formatter: 'Table.api.formatter.datetime' },
        { operate: true, title: 'Operate' },
      ],
    })
  }

  private publicRoot(): string {
    // resolve fastAdmin/public/ relative to repo root
    return path.resolve(process.cwd(), '..', 'fastAdmin', 'public')
  }

  private async loadCategoryNames(): Promise<Set<string>> {
    const row = await this.configs.findOneBy({ name: 'attachmentcategory' })
    const out = new Set<string>(['unclassed'])
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as Record<string, string>
        for (const k of Object.keys(parsed)) out.add(k)
      } catch { /* ignore */ }
    }
    return out
  }
}

function isAjax(req: Request): boolean {
  return String(req.headers['x-requested-with'] ?? '').toLowerCase() === 'xmlhttprequest'
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Body fields for the attachment EDIT form. Mirrors
 * application/admin/view/general/attachment/edit.html — the fields the PHP
 * form exposes (category, url, image dims/type/frames, filename/size,
 * mimetype, extparam) plus admin_id/user_id which the entity tracks.
 */
function buildAttachmentEditFormFields(opts: { row: AttachmentEntity; categoryOptions: string }): string {
  const row = opts.row
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Category</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[category]" class="form-control">
      ${opts.categoryOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Url</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[url]" class="form-control" data-rule="required;" value="${escapeHtml(row.url)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Imagewidth</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[imagewidth]" class="form-control" value="${escapeHtml(row.imagewidth)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Imageheight</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[imageheight]" class="form-control" value="${escapeHtml(String(row.imageheight ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Imagetype</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[imagetype]" class="form-control" value="${escapeHtml(row.imagetype)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Imageframes</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[imageframes]" class="form-control" value="${escapeHtml(String(row.imageframes ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Filesize</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[filesize]" class="form-control" value="${escapeHtml(String(row.filesize ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Mimetype</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[mimetype]" class="form-control" value="${escapeHtml(row.mimetype)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Extparam</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[extparam]" class="form-control" value="${escapeHtml(row.extparam)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Admin ID</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[admin_id]" class="form-control" value="${escapeHtml(String(row.admin_id ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">User ID</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[user_id]" class="form-control" value="${escapeHtml(String(row.user_id ?? 0))}"></div>
</div>`
}
