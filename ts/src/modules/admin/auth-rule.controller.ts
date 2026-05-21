// admin/auth/Rule — auth_rule CRUD. Super-admin only.
// Mirrors application/admin/controller/auth/Rule.php.
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
import { Repository, In, Not } from 'typeorm'
import type { Request } from 'express'
import { AuthRuleEntity } from '../../entities/auth-rule.entity.ts'
import { AuthGroupEntity } from '../../entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from '../../entities/auth-group-access.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { Tree } from '../../common/tree.ts'
import { ViewService } from '../../services/view.service.ts'

interface RuleSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type RuleReq = Request & { session: RuleSession & { [k: string]: unknown } }

@Controller('admin.php/auth/rule')
@UseGuards(AdminAuthGuard)
export class AuthRuleController {
  constructor(
    @InjectRepository(AuthRuleEntity) private readonly rules: Repository<AuthRuleEntity>,
    @InjectRepository(AuthGroupEntity) private readonly groups: Repository<AuthGroupEntity>,
    @InjectRepository(AuthGroupAccessEntity) private readonly access: Repository<AuthGroupAccessEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {}

  // -------- index. --------
  @Get('index')
  async indexGet(@Req() req: RuleReq): Promise<unknown> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax()
  }

  private async indexAjax(): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const all = await this.rules.find({ order: { weigh: 'DESC', id: 'ASC' } })
    const tree = new Tree<AuthRuleEntity>().init(all, 'pid')
    const list = tree.getTreeList(tree.getTreeArray(0), 'title') as unknown as Array<Record<string, unknown>>
    return { total: list.length, rows: list }
  }

  // -------- add. --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getAdd(@Req() req: RuleReq): Promise<string | AdminEnvelope<unknown>> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    const tok = this.csrf.issue(req.session)
    const pidOptions = await this.buildPidOptions()
    const fields = buildAuthRuleFormFields({ pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Add Rule',
      formAction: '/admin.php/auth/rule/add',
      __token__: tok,
      fields,
      req,
      controllername: 'auth.rule',
      actionname: 'add',
    })
  }

  /** <option> list for the pid selector — tree-indented by title. */
  private async buildPidOptions(selectedPid?: number): Promise<string> {
    const all = await this.rules.find({ order: { weigh: 'DESC', id: 'ASC' } })
    const tree = new Tree<AuthRuleEntity>().init(all, 'pid')
    const flat = tree.getTreeList(tree.getTreeArray(0), 'title')
    const options: string[] = [`<option value="0"${selectedPid == null || selectedPid === 0 ? ' selected' : ''}>None</option>`]
    for (const r of flat) {
      const label = String((r as unknown as Record<string, unknown>).title ?? '')
      const sel = selectedPid != null && Number(selectedPid) === Number(r.id) ? ' selected' : ''
      options.push(`<option value="${r.id}"${sel}>${escapeHtml(label)}</option>`)
    }
    return options.join('\n')
  }

  @Post('add')
  @HttpCode(200)
  async postAdd(
    @Req() req: RuleReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const row = body['row']
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) {
      return adminErr('Parameter %s can not be empty')
    }
    const r = row as Record<string, unknown>
    const ismenu = Number(r.ismenu ?? 0)
    const pid = parseInt(String(r.pid ?? '0'), 10)
    if (!ismenu && !pid) return adminErr('非菜单规则节点必须有父级')
    const name = String(r.name ?? '').trim()
    if (!name) return adminErr('Name can not be empty')

    // Name uniqueness.
    if (await this.rules.findOneBy({ name })) return adminErr('Name already exists')

    const now = Math.floor(Date.now() / 1000)
    try {
      const saved = await this.rules.save(this.rules.create({
        type: String(r.type ?? 'file'),
        pid,
        name,
        title: String(r.title ?? ''),
        icon: String(r.icon ?? ''),
        url: String(r.url ?? ''),
        condition: String(r.condition ?? ''),
        remark: String(r.remark ?? ''),
        ismenu,
        menutype: String(r.menutype ?? '') as string,
        extend: String(r.extend ?? ''),
        weigh: parseInt(String(r.weigh ?? '0'), 10) || 0,
        status: String(r.status ?? 'normal'),
        createtime: now,
        updatetime: now,
      }))
      return adminOk('', { id: saved.id })
    } catch (e) {
      return adminErr((e as Error).message)
    }
  }

  // -------- edit. --------
  @Get('edit/ids/:id')
  async getEditPathId(@Req() req: RuleReq, @Param('id') idStr: string): Promise<unknown> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    return this.renderEditOrError(req, parseInt(idStr, 10))
  }

  @Get('edit')
  async getEdit(@Req() req: RuleReq, @Query('ids') idsQ?: string): Promise<unknown> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    return this.renderEditOrError(req, parseInt(idsQ ?? '0', 10))
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: RuleReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/auth/rule/edit/ids/<id>` (the form's
  // generated action). NestJS routes are explicit, so we need a matching
  // POST route that takes id from the path.
  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPathId(
    @Req() req: RuleReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, idStr)
  }

  private async postEditImpl(
    req: RuleReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const id = parseInt(String(pathId ?? body['ids'] ?? '0'), 10)
    if (!Number.isFinite(id) || id <= 0) return adminErr('记录不存在')
    const row = await this.rules.findOneBy({ id })
    if (!row) return adminErr('记录不存在')

    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('Parameter %s can not be empty')
    const r = rowParam as Record<string, unknown>

    const ismenu = Number(r.ismenu ?? 0)
    const pid = parseInt(String(r.pid ?? '0'), 10)
    if (!ismenu && !pid) return adminErr('非菜单规则节点必须有父级')
    if (pid === row.id) return adminErr('父级不能是它自己')
    if (pid !== row.pid) {
      const all = await this.rules.find()
      const tree = new Tree<AuthRuleEntity>().init(all, 'pid')
      const childIds = tree.getChildrenIds(row.id)
      if (childIds.includes(pid)) return adminErr('父级不能是它的子级')
    }
    const name = String(r.name ?? '').trim()
    if (!name) return adminErr('Name can not be empty')
    // Name uniqueness (excluding self).
    const dup = await this.rules.findOne({ where: { name, id: Not(id) } })
    if (dup) return adminErr('Name already exists')

    const updateBag: Partial<AuthRuleEntity> = {
      type: String(r.type ?? row.type),
      pid,
      name,
      title: String(r.title ?? row.title),
      icon: String(r.icon ?? row.icon),
      url: String(r.url ?? row.url),
      condition: String(r.condition ?? row.condition),
      remark: String(r.remark ?? row.remark),
      ismenu,
      menutype: String(r.menutype ?? row.menutype ?? '') as string,
      extend: String(r.extend ?? row.extend),
      weigh: parseInt(String(r.weigh ?? row.weigh), 10) || 0,
      status: String(r.status ?? row.status),
      updatetime: Math.floor(Date.now() / 1000),
    }
    await this.rules.update({ id }, updateBag)
    return adminOk('')
  }

  private async renderEditOrError(req: RuleReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('记录不存在') : this.renderErrorHtml(req, '记录不存在')
    }
    const row = await this.rules.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('记录不存在') : this.renderErrorHtml(req, '记录不存在')
    }
    const tok = this.csrf.issue(req.session)
    const pidOptions = await this.buildPidOptions(row.pid)
    const fields = buildAuthRuleEditFormFields({ row, pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Edit Rule',
      formId: 'edit-form',
      formAction: `/admin.php/auth/rule/edit/ids/${row.id}`,
      __token__: tok,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'auth.rule',
      actionname: 'edit',
    })
  }

  // -------- del (cascading). --------
  @Get('del')
  @HttpCode(200)
  delGet(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }

  @Get('del/ids/:id')
  @HttpCode(200)
  delGetWithId(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }

  @Post('del')
  @HttpCode(200)
  async postDel(
    @Req() req: RuleReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!(await this.assertSuper(req))) return adminErr('Access is allowed only to the super management group')
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (idArr.length === 0) return adminErr('Parameter %s can not be empty')

    const all = await this.rules.find()
    const tree = new Tree<AuthRuleEntity>().init(all, 'pid')
    const toDelete = new Set<number>()
    for (const id of idArr) {
      for (const cid of tree.getChildrenIds(id, true)) toDelete.add(cid)
    }
    if (toDelete.size === 0) return adminErr('No rows were deleted')
    await this.rules.delete({ id: In(Array.from(toDelete)) })
    return adminOk('')
  }

  // -------- helpers --------
  private async assertSuper(req: RuleReq): Promise<boolean> {
    const adminId = req.session.admin?.id ?? 0
    const rows = await this.access.find({ where: { uid: adminId } })
    if (rows.length === 0) return false
    const groupIds = rows.map((r) => r.group_id)
    const grp = await this.groups.findOne({ where: { id: In(groupIds), rules: '*' } })
    return !!grp
  }

  private renderListHtml(req: RuleReq): string {
    this.csrf.issue(req.session)
    return this.view.renderListPage({
      pageTitle: 'Rule',
      tableId: 'table',
      indexUrl: '/admin.php/auth/rule/index',
      addUrl: '/admin.php/auth/rule/add',
      editUrl: '/admin.php/auth/rule/edit',
      delUrl: '/admin.php/auth/rule/del',
      req,
      controllername: 'auth.rule',
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

  private renderErrorHtml(req: RuleReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'auth.rule',
      actionname: 'error',
    })
  }
}

function isAjax(req: Request): boolean {
  return String(req.headers['x-requested-with'] ?? '').toLowerCase() === 'xmlhttprequest'
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Body fields for the auth_rule ADD form. Mirrors
 * application/admin/view/auth/rule/add.html — 8 form-groups: pid, ismenu,
 * type, name, title, icon, weigh, status.
 */
function buildAuthRuleFormFields(opts: { pidOptions: string }): string {
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
  <label class="control-label col-xs-12 col-sm-2">Type</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[type]" value="menu" checked> Menu</label>
    <label class="radio-inline"><input type="radio" name="row[type]" value="file"> File</label>
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
 * Body fields for the auth_rule EDIT form. Mirrors the add layout but
 * prefills every input from the row and marks selected radio/option values.
 */
function buildAuthRuleEditFormFields(opts: { row: AuthRuleEntity; pidOptions: string }): string {
  const row = opts.row
  const ismenu = Number(row.ismenu ?? 0)
  const type = String(row.type ?? 'file')
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
  <label class="control-label col-xs-12 col-sm-2">Type</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[type]" value="menu"${type === 'menu' ? ' checked' : ''}> Menu</label>
    <label class="radio-inline"><input type="radio" name="row[type]" value="file"${type === 'file' ? ' checked' : ''}> File</label>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;" value="${escapeHtml(row.name)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Title</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[title]" class="form-control" data-rule="required;" value="${escapeHtml(row.title)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Icon</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[icon]" class="form-control" value="${escapeHtml(row.icon ?? 'fa fa-circle-o')}"></div>
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
