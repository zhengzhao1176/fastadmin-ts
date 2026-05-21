// admin/user/Rule — frontend user rule CRUD with cascading delete.
// Mirrors application/admin/controller/user/Rule.php.
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
import { UserRuleEntity } from '../../entities/user-rule.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { Tree } from '../../common/tree.ts'
import { ViewService } from '../../services/view.service.ts'

interface URSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type URReq = Request & { session: URSession & { [k: string]: unknown } }

@Controller('admin.php/user/rule')
@UseGuards(AdminAuthGuard)
export class UserRuleController {
  constructor(
    @InjectRepository(UserRuleEntity) private readonly rules: Repository<UserRuleEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {}

  // -------- index --------
  @Get('index')
  async indexGet(@Req() req: URReq): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax()
  }
  @Post('index')
  @HttpCode(200)
  async indexPost(): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    return this.indexAjax()
  }

  private async indexAjax(): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const all = await this.rules.find({ order: { weigh: 'DESC' } })
    const tree = new Tree<UserRuleEntity>().init(all, 'pid')
    const list = tree.getTreeList(tree.getTreeArray(0), 'title') as unknown as Array<Record<string, unknown>>
    return { total: list.length, rows: list }
  }

  // -------- add --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getAdd(@Req() req: URReq): Promise<string> {
    const tok = this.csrf.issue(req.session)
    const pidOptions = await this.buildPidOptions()
    const fields = buildUserRuleFormFields({ pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Add User Rule',
      formAction: '/admin.php/user/rule/add',
      __token__: tok,
      fields,
      req,
      controllername: 'user.rule',
      actionname: 'add',
    })
  }

  /** <option> list for the pid selector — tree-indented by title. */
  private async buildPidOptions(selectedPid?: number | null): Promise<string> {
    const all = await this.rules.find({ order: { weigh: 'DESC' } })
    const tree = new Tree<UserRuleEntity>().init(all, 'pid')
    const flat = tree.getTreeList(tree.getTreeArray(0), 'title')
    const opts: string[] = [`<option value="0"${selectedPid == null || Number(selectedPid) === 0 ? ' selected' : ''}>None</option>`]
    for (const r of flat) {
      const label = String((r as unknown as Record<string, unknown>).title ?? '')
      const sel = selectedPid != null && Number(selectedPid) === Number(r.id) ? ' selected' : ''
      opts.push(`<option value="${r.id}"${sel}>${escapeHtml(label)}</option>`)
    }
    return opts.join('\n')
  }

  @Post('add')
  @HttpCode(200)
  async postAdd(
    @Req() req: URReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const r = body['row']
    if (!r || typeof r !== 'object') return adminErr('Parameter %s can not be empty')
    const params = r as Record<string, unknown>
    const name = String(params.name ?? '').trim()
    if (!name) return adminErr('Name can not be empty')
    if (await this.rules.findOneBy({ name })) return adminErr('Name already exists')
    const now = Math.floor(Date.now() / 1000)
    try {
      const saved = await this.rules.save(this.rules.create({
        pid: parseInt(String(params.pid ?? '0'), 10) || 0,
        name,
        title: String(params.title ?? ''),
        remark: String(params.remark ?? ''),
        ismenu: parseInt(String(params.ismenu ?? '1'), 10),
        weigh: parseInt(String(params.weigh ?? '0'), 10) || 0,
        status: String(params.status ?? 'normal'),
        createtime: now,
        updatetime: now,
      }))
      return adminOk('', { id: saved.id })
    } catch (e) {
      return adminErr((e as Error).message)
    }
  }

  // -------- edit --------
  @Get('edit/ids/:id')
  async getEdit(@Req() req: URReq, @Param('id') idStr: string): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idStr, 10))
  }

  private async renderEditOrError(req: URReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.rules.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    const pidOptions = await this.buildPidOptions(row.pid)
    const fields = buildUserRuleEditFormFields({ row, pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Edit User Rule',
      formId: 'edit-form',
      formAction: `/admin.php/user/rule/edit/ids/${row.id}`,
      __token__: tok,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'user.rule',
      actionname: 'edit',
    })
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: URReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/user/rule/edit/ids/<id>` (the form's
  // generated action). NestJS routes are explicit, so we need a matching
  // POST route that takes id from the path.
  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPathId(
    @Req() req: URReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, idStr)
  }

  private async postEditImpl(
    req: URReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const id = parseInt(String(pathId ?? body['ids'] ?? '0'), 10)
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')
    const row = await this.rules.findOneBy({ id })
    if (!row) return adminErr('No Results were found')
    const r = body['row']
    if (!r || typeof r !== 'object') return adminErr('Parameter %s can not be empty')
    const params = r as Record<string, unknown>
    await this.rules.update({ id }, {
      pid: params.pid != null ? Number(params.pid) : row.pid,
      name: params.name != null ? String(params.name) : row.name,
      title: params.title != null ? String(params.title) : row.title,
      remark: params.remark != null ? String(params.remark) : row.remark,
      ismenu: params.ismenu != null ? Number(params.ismenu) : row.ismenu,
      weigh: params.weigh != null ? Number(params.weigh) : row.weigh,
      status: params.status != null ? String(params.status) : (row.status ?? 'normal'),
      updatetime: Math.floor(Date.now() / 1000),
    })
    return adminOk('')
  }

  // -------- del (cascading children). --------
  @Get('del')
  @HttpCode(200)
  delGet(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }
  @Get('del/ids/:id')
  @HttpCode(200)
  delGetPath(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }

  @Post('del')
  @HttpCode(200)
  async del(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (idArr.length === 0) return adminErr('Parameter %s can not be empty')
    const all = await this.rules.find()
    const tree = new Tree<UserRuleEntity>().init(all, 'pid')
    const toDelete = new Set<number>()
    for (const id of idArr) {
      for (const cid of tree.getChildrenIds(id, true)) toDelete.add(cid)
    }
    if (toDelete.size === 0) return adminErr('No rows were deleted')
    await this.rules.delete({ id: In(Array.from(toDelete)) })
    return adminOk('')
  }

  // -------- multi (PHP allows ismenu,status). --------
  @Post('multi')
  @HttpCode(200)
  async multi(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const paramsStr = String(body['params'] ?? '')
    if (!paramsStr) return adminErr('No rows were updated')
    const values: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(paramsStr).entries()) values[k] = v
    const allowed = ['ismenu', 'status']
    const final: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) if (allowed.includes(k)) final[k] = v
    if (Object.keys(final).length === 0) return adminErr('No rows were updated')
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    const res = await this.rules.update({ id: In(idArr) }, final as Partial<UserRuleEntity>)
    if (!(res.affected ?? 0)) return adminErr('No rows were updated')
    return adminOk('')
  }

  private renderListHtml(req: URReq): string {
    this.csrf.issue(req.session)
    return this.view.renderListPage({
      pageTitle: 'User Rule',
      tableId: 'table',
      indexUrl: '/admin.php/user/rule/index',
      addUrl: '/admin.php/user/rule/add',
      editUrl: '/admin.php/user/rule/edit',
      delUrl: '/admin.php/user/rule/del',
      req,
      controllername: 'user.rule',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'pid', title: 'Parent' },
        { field: 'name', title: 'Name' },
        { field: 'title', title: 'Title' },
        { field: 'ismenu', title: 'Menu' },
        { field: 'status', title: 'Status' },
        { operate: true, title: 'Operate' },
      ],
    })
  }

  private renderErrorHtml(req: URReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'user.rule',
      actionname: 'error',
    })
  }
}

function isAjax(req: Request): boolean {
  return String(req.headers['x-requested-with'] ?? '').toLowerCase() === 'xmlhttprequest'
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Body fields for the user_rule ADD form. Mirrors
 * application/admin/view/user/rule/add.html — 7 form-groups: pid, ismenu,
 * name, title, icon, weigh, status.
 */
function buildUserRuleFormFields(opts: { pidOptions: string }): string {
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Parent</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[pid]" class="form-control selectpicker">
      ${opts.pidOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Is Menu</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[ismenu]" value="1" checked> Yes</label>
    <label class="radio-inline"><input type="radio" name="row[ismenu]" value="0"> No</label>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Title</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[title]" class="form-control" data-rule="required;"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Icon</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[icon]" class="form-control" value="fa fa-circle-o"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Weigh</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[weigh]" class="form-control" value="0"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal" checked> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"> Hidden</label>
  </div>
</div>`
}

/**
 * Body fields for the user_rule EDIT form. Same layout as add but prefilled
 * from the row.
 */
function buildUserRuleEditFormFields(opts: { row: UserRuleEntity; pidOptions: string }): string {
  const row = opts.row
  const ismenu = Number(row.ismenu ?? 0)
  const status = String(row.status ?? 'normal')
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Parent</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[pid]" class="form-control selectpicker">
      ${opts.pidOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Is Menu</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[ismenu]" value="1"${ismenu === 1 ? ' checked' : ''}> Yes</label>
    <label class="radio-inline"><input type="radio" name="row[ismenu]" value="0"${ismenu === 0 ? ' checked' : ''}> No</label>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;" value="${escapeHtml(row.name ?? '')}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Title</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[title]" class="form-control" data-rule="required;" value="${escapeHtml(row.title)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Icon</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[icon]" class="form-control" value="fa fa-circle-o"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Weigh</label>
  <div class="col-xs-12 col-sm-8"><input type="number" name="row[weigh]" class="form-control" value="${escapeHtml(String(row.weigh ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal"${status === 'normal' ? ' checked' : ''}> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"${status === 'hidden' ? ' checked' : ''}> Hidden</label>
  </div>
</div>`
}
