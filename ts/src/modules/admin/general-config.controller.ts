// admin/general/Config — system config CRUD + util endpoints.
// Mirrors application/admin/controller/general/Config.php.
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
import { Repository, DataSource } from 'typeorm'
import type { Request } from 'express'
import { ConfigEntity } from '../../entities/config.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { MailerService } from '../../services/mailer.service.ts'
import { BackendCrudService } from '../../services/backend-crud.service.ts'
import { NoNeedRight } from '../../common/no-need-right.decorator.ts'
import { ViewService } from '../../services/view.service.ts'

interface ConfigSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type ConfigReq = Request & { session: ConfigSession & { [k: string]: unknown } }

const TYPES_WITH_CONTENT = new Set(['select', 'selects', 'checkbox', 'radio', 'array'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REGEX_LIST: Record<string, string> = {
  required: '必选',
  digits: '数字',
  letters: '字母',
  date: '日期',
  time: '时间',
  email: '邮箱',
  url: '网址',
  qq: 'QQ号',
  IDcard: '身份证',
  tel: '座机电话',
  mobile: '手机号',
  zipcode: '邮编',
  chinese: '中文',
  username: '用户名',
  password: '密码',
}

@Controller('admin.php/general/config')
@UseGuards(AdminAuthGuard)
@NoNeedRight(['check', 'rulelist', 'selectpage', 'get_fields_list', 'get_table_list'])
export class GeneralConfigController {
  private readonly crud: BackendCrudService<ConfigEntity>

  constructor(
    @InjectRepository(ConfigEntity) private readonly configs: Repository<ConfigEntity>,
    private readonly csrf: CsrfService,
    private readonly mailer: MailerService,
    private readonly dataSource: DataSource,
    private readonly view: ViewService,
  ) {
    this.crud = new BackendCrudService(this.configs)
  }

  @Get('index')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getIndex(@Req() req: ConfigReq): Promise<string> {
    const tok = this.csrf.issue(req.session)
    // Render real config form: one tab per group, with the fields that
    // currently exist in fa_config. AdminLTE chrome wraps via ViewService.
    const groups = new Map<string, string[]>()
    for (const row of await this.configs.find()) {
      if (!groups.has(row.group)) groups.set(row.group, [])
      const value = String(row.value ?? '').replace(/"/g, '&quot;')
      const type = (row.type === 'text' || row.type === 'longtext') ? 'textarea' : 'input'
      const inputField = type === 'textarea'
        ? `<textarea class="form-control" name="row[${row.name}]">${value}</textarea>`
        : `<input class="form-control" type="text" name="row[${row.name}]" value="${value}">`
      groups.get(row.group)!.push(
        `<div class="form-group"><label class="col-xs-2 control-label">${escapeHtml(row.title)}</label><div class="col-xs-8">${inputField}<small class="text-muted">${escapeHtml(row.tip ?? '')}</small></div></div>`,
      )
    }
    let fields = `<input type="hidden" name="__token__" value="${tok}">`
    for (const [group, rows] of groups.entries()) {
      fields += `<h4 class="config-group">${escapeHtml(group)}</h4>` + rows.join('')
    }
    return this.view.renderFormPage({
      pageTitle: 'Config',
      formId: 'config-form',
      formAction: '/admin.php/general/config/edit',
      __token__: tok,
      fields,
      req,
      controllername: 'general.config',
      actionname: 'index',
    })
  }

  // -------- add (gated on app_debug in PHP; we treat tests as debug). --------
  @Post('add')
  @HttpCode(200)
  async add(
    @Req() req: ConfigReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const row = body['row']
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) {
      return adminErr('Parameter %s can not be empty')
    }
    const params: Record<string, unknown> = { ...(row as Record<string, unknown>) }
    // Implode array fields (except `setting`).
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v) && k !== 'setting') params[k] = v.join(',')
    }
    const type = String(params.type ?? '')
    if (TYPES_WITH_CONTENT.has(type)) {
      const decoded = decodeKvText(String(params.content ?? ''))
      params.content = JSON.stringify(decoded)
    } else {
      params.content = ''
    }
    // before_write guard.
    if (params.name === 'name' && /fastadmin/i.test(String(params.value ?? ''))) {
      return adminErr('Site name incorrect')
    }
    try {
      const saved = await this.configs.save(this.configs.create(params as Partial<ConfigEntity>))
      return adminOk('', { id: saved.id })
    } catch (e) {
      return adminErr((e as Error).message)
    }
  }

  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdd(@Req() req: ConfigReq): string {
    const tok = this.csrf.issue(req.session)
    return `<!doctype html><html><body>
<form method="POST" action="/admin.php/general/config/add">
  <input type="hidden" name="__token__" value="${tok}">
</form></body></html>`
  }

  // -------- edit (batch update by config-row name). --------
  @Post('edit')
  @HttpCode(200)
  async edit(
    @Req() req: ConfigReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.editImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/general/config/edit/ids/<id>`. Config is
  // a batch update keyed by row.name (id is unused), but the route must
  // exist to avoid a 404 when the form posts to the path-id variant.
  @Post('edit/ids/:id')
  @HttpCode(200)
  async editPathId(
    @Req() req: ConfigReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.editImpl(req, body, idStr)
  }

  private async editImpl(
    req: ConfigReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    void pathId
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const row = body['row']
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) {
      return adminErr('Parameter %s can not be empty')
    }
    const submitted = row as Record<string, unknown>
    const all = await this.configs.find()
    const updates: Array<{ id: number; value: string; name: string }> = []
    for (const v of all) {
      if (!(v.name in submitted)) continue
      let value = submitted[v.name] as unknown
      if (Array.isArray(value)) {
        value = value.join(',')
      } else if (value && typeof value === 'object' && 'field' in (value as Record<string, unknown>)) {
        value = JSON.stringify(getArrayData(value as Record<string, unknown>))
      } else if (value && typeof value === 'object') {
        value = Object.values(value as Record<string, unknown>).join(',')
      } else {
        value = value == null ? '' : String(value)
      }
      // before_write guard.
      if (v.name === 'name' && /fastadmin/i.test(String(value))) {
        return adminErr('Site name incorrect')
      }
      updates.push({ id: v.id, value: String(value), name: v.name })
    }
    if (updates.length === 0) return adminErr('Parameter %s can not be empty')
    let mailChanged = false
    for (const u of updates) {
      await this.configs.update({ id: u.id }, { value: u.value })
      if (u.name.startsWith('mail_')) mailChanged = true
    }
    if (mailChanged) await this.mailer.reload().catch(() => { /* ignore */ })
    return adminOk('')
  }

  // -------- del (by name). --------
  @Post('del')
  @HttpCode(200)
  async del(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const name = String(body['name'] ?? '')
    if (!name) return adminErr('Invalid parameters')
    const row = await this.configs.findOneBy({ name })
    if (!row) return adminErr('Invalid parameters')
    await this.configs.delete({ id: row.id })
    return adminOk('')
  }

  // -------- check: "is this name already used?" (returns code 0 if taken). --------
  @Post('check')
  @HttpCode(200)
  async check(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const row = body['row']
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) {
      return adminErr('Invalid parameters')
    }
    const r = row as Record<string, unknown>
    const where: Record<string, unknown> = {}
    if (r.name != null) where.name = String(r.name)
    if (r.id != null) where.id = Number(r.id)
    if (Object.keys(where).length === 0) return adminErr('Invalid parameters')
    const existing = await this.configs.findOneBy(where as { name?: string; id?: number })
    if (existing) return adminErr('Name already exist')
    return adminOk('')
  }

  // -------- rulelist: raw { list: [{id, name}] } payload. --------
  @Get('rulelist')
  rulelist(@Query() q: Record<string, string>): { list: Array<{ id: string; name: string }> } {
    const keyValue = String(q.keyValue ?? '').split(',').filter((s) => s.length > 0)
    const list: Array<{ id: string; name: string }> = []
    for (const [k, v] of Object.entries(REGEX_LIST)) {
      if (keyValue.length === 0 || keyValue.includes(k)) {
        list.push({ id: k, name: v })
      }
    }
    return { list }
  }

  // -------- emailtest: send a test email via MailerService. --------
  @Post('emailtest')
  @HttpCode(200)
  async emailtest(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const receiver = String(body['receiver'] ?? '')
    if (!receiver) return adminErr('Invalid parameters')
    if (!EMAIL_RE.test(receiver)) return adminErr('Please input correct email')
    const row = (body['row'] as Record<string, unknown> | undefined) ?? {}
    const ok = await this.mailer.send({
      to: receiver,
      subject: 'This is a test mail',
      text: 'This is a test mail content',
      from: String(row['mail_from'] ?? 'noreply@test.local'),
    })
    if (!ok) return adminErr('Send mail failed')
    return adminOk('')
  }

  // -------- selectpage: look up referenced table via config.setting JSON. --------
  @Get('selectpage')
  async selectpage(@Query() q: Record<string, unknown>): Promise<{ list: unknown[]; total: number } | AdminEnvelope<unknown>> {
    const id = parseInt(String(q.id ?? '0'), 10)
    if (!id) return adminErr('Invalid parameters')
    const cfg = await this.configs.findOneBy({ id })
    if (!cfg) return adminErr('Invalid parameters')
    let setting: Record<string, unknown> = {}
    try { setting = cfg.setting ? JSON.parse(cfg.setting) : {} } catch { /* ignore */ }
    const table = String(setting.table ?? '')
    const primarykey = String(setting.primarykey ?? 'id')
    const field = String(setting.field ?? 'name')
    if (!table) return adminErr('Invalid parameters')

    const pageNumber = Math.max(1, parseInt(String(q.pageNumber ?? '1'), 10) || 1)
    const pageSize = Math.max(1, parseInt(String(q.pageSize ?? '10'), 10) || 10)
    const offset = (pageNumber - 1) * pageSize

    const [total] = await this.dataSource.query(
      `SELECT COUNT(*) AS c FROM \`${table.replace(/`/g, '')}\``,
    )
    const totalCount = Number((total as { c?: number | string }).c ?? 0)
    const rows = await this.dataSource.query(
      `SELECT \`${primarykey}\` AS pk, \`${field}\` AS f FROM \`${table.replace(/`/g, '')}\` LIMIT ? OFFSET ?`,
      [pageSize, offset],
    ) as Array<{ pk: unknown; f: unknown }>
    const list = rows.map((r) => ({
      [primarykey]: r.pk,
      [field]: r.f,
      pid: 0,
    }))
    return { list, total: totalCount }
  }

  // -------- get_table_list: INFORMATION_SCHEMA scan. --------
  @Get('get_table_list')
  async getTableList(): Promise<AdminEnvelope<{ tableList: Array<{ name: string; title: string }> }>> {
    const dbname = (await this.dataSource.query('SELECT DATABASE() AS d'))[0]?.d as string
    const rows = await this.dataSource.query(
      'SELECT TABLE_NAME AS name, TABLE_COMMENT AS title FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [dbname],
    ) as Array<{ name: string; title: string }>
    return adminOk('', { tableList: rows })
  }

  // -------- get_fields_list: per-table column metadata. --------
  @Get('get_fields_list')
  async getFieldsList(@Query('table') table: string): Promise<AdminEnvelope<{ fieldList: Array<{ name: string; title: string; type: string }> }>> {
    const dbname = (await this.dataSource.query('SELECT DATABASE() AS d'))[0]?.d as string
    const rows = await this.dataSource.query(
      'SELECT COLUMN_NAME AS name, COLUMN_COMMENT AS title, DATA_TYPE AS type FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [dbname, table ?? ''],
    ) as Array<{ name: string; title: string; type: string }>
    return adminOk('', { fieldList: rows })
  }
}

/**
 * PHP Config::decode($text, "\r\n"): split lines, split each on '|', return
 * key→value object. Lines without '|' are skipped.
 */
function decodeKvText(text: string, split = /\r?\n/): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(split)) {
    if (!line.includes('|')) continue
    const idx = line.indexOf('|')
    const k = line.slice(0, idx)
    const v = line.slice(idx + 1)
    out[k] = v
  }
  return out
}

/**
 * PHP Config::getArrayData(): pair `field[]` with `value[]` (skipping empty
 * keys) into an associative array.
 */
function getArrayData(data: Record<string, unknown>): Record<string, unknown> {
  const field = data.field as unknown as Record<string, string> | string[] | undefined
  const value = data.value as unknown as Record<string, string> | string[] | undefined
  const out: Record<string, unknown> = {}
  const fieldArr = field ? (Array.isArray(field) ? field : Object.values(field)) : []
  const valueArr = value ? (Array.isArray(value) ? value : Object.values(value)) : []
  for (let i = 0; i < fieldArr.length; i++) {
    const k = fieldArr[i]
    if (k != null && k !== '') {
      out[String(k)] = valueArr[i] ?? ''
    }
  }
  return out
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
