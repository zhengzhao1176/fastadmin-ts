// admin/user/Group — frontend user group CRUD.
// Mirrors application/admin/controller/user/Group.php (inherits Backend trait).
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
import { UserGroupEntity } from '../../entities/user-group.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { BackendCrudService, parseStr } from '../../services/backend-crud.service.ts'
import { ViewService } from '../../services/view.service.ts'

interface UGSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type UGReq = Request & { session: UGSession & { [k: string]: unknown } }

@Controller('admin.php/user/group')
@UseGuards(AdminAuthGuard)
export class UserGroupController {
  private readonly crud: BackendCrudService<UserGroupEntity>

  constructor(
    @InjectRepository(UserGroupEntity) private readonly groups: Repository<UserGroupEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {
    this.crud = new BackendCrudService(this.groups, { multiFields: 'status' })
  }

  // -------- index --------
  @Get('index')
  async indexGet(@Req() req: UGReq, @Query() q: Record<string, string>): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax(q)
  }
  @Post('index')
  @HttpCode(200)
  async indexPost(@Body() body: Record<string, string>, @Query() q: Record<string, string>): Promise<unknown> {
    return this.indexAjax({ ...body, ...q })
  }

  private async indexAjax(q: Record<string, unknown>): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const limit = Math.max(1, parseInt(String(q.limit ?? '10'), 10) || 10)
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
    const offset = (page - 1) * limit
    const qb = this.groups.createQueryBuilder('g')
    const search = String(q.search ?? '').trim()
    if (search) qb.where('(g.id LIKE :s OR g.name LIKE :s)', { s: `%${search}%` })
    const total = await qb.getCount()
    qb.orderBy('g.id', 'DESC').skip(offset).take(limit)
    const rows = await qb.getMany()
    return { total, rows: rows as unknown as Array<Record<string, unknown>> }
  }

  // -------- add --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdd(@Req() req: UGReq): string {
    const tok = this.csrf.issue(req.session)
    const fields = buildUserGroupFormFields()
    return this.view.renderFormPage({
      pageTitle: 'Add User Group',
      formAction: '/admin.php/user/group/add',
      __token__: tok,
      fields,
      req,
      controllername: 'user.group',
      actionname: 'add',
    })
  }

  @Post('add')
  @HttpCode(200)
  async postAdd(
    @Req() req: UGReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const r = body['row']
    if (!r || typeof r !== 'object') return adminErr('Parameter %s can not be empty')
    const params = r as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    try {
      const saved = await this.groups.save(this.groups.create({
        name: String(params.name ?? ''),
        rules: String(params.rules ?? ''),
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
  async getEdit(@Req() req: UGReq, @Param('id') idStr: string): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idStr, 10))
  }

  private async renderEditOrError(req: UGReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.groups.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    const fields = buildUserGroupEditFormFields({ row })
    return this.view.renderFormPage({
      pageTitle: 'Edit User Group',
      formId: 'edit-form',
      formAction: `/admin.php/user/group/edit/ids/${row.id}`,
      __token__: tok,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'user.group',
      actionname: 'edit',
    })
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: UGReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/user/group/edit/ids/<id>` (the form's
  // generated action). NestJS routes are explicit, so we need a matching
  // POST route that takes id from the path.
  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPathId(
    @Req() req: UGReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, idStr)
  }

  private async postEditImpl(
    req: UGReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const id = parseInt(String(pathId ?? body['ids'] ?? '0'), 10)
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')
    const row = await this.groups.findOneBy({ id })
    if (!row) return adminErr('No Results were found')
    const r = body['row']
    if (!r || typeof r !== 'object') return adminErr('Parameter %s can not be empty')
    const params = r as Record<string, unknown>
    await this.groups.update({ id }, {
      name: params.name != null ? String(params.name) : row.name,
      rules: params.rules != null ? String(params.rules) : row.rules,
      status: params.status != null ? String(params.status) : (row.status ?? 'normal'),
      updatetime: Math.floor(Date.now() / 1000),
    })
    return adminOk('')
  }

  // -------- del --------
  @Post('del')
  @HttpCode(200)
  async del(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const count = await this.crud.del(ids)
    if (!count) return adminErr('No rows were deleted')
    return adminOk('')
  }

  // -------- multi --------
  @Post('multi')
  @HttpCode(200)
  async multi(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const paramsStr = String(body['params'] ?? '')
    if (!paramsStr) return adminErr('No rows were updated')
    const values = parseStr(paramsStr)
    const count = await this.crud.multi(ids, values, true)
    if (!count) return adminErr('No rows were updated')
    return adminOk('')
  }

  private renderListHtml(req: UGReq): string {
    this.csrf.issue(req.session)
    return this.view.renderListPage({
      pageTitle: 'User Group',
      tableId: 'table',
      indexUrl: '/admin.php/user/group/index',
      addUrl: '/admin.php/user/group/add',
      editUrl: '/admin.php/user/group/edit',
      delUrl: '/admin.php/user/group/del',
      multiUrl: '/admin.php/user/group/multi',
      req,
      controllername: 'user.group',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'name', title: 'Name' },
        { field: 'rules', title: 'Rules' },
        { field: 'status', title: 'Status' },
        { operate: true, title: 'Operate' },
      ],
    })
  }

  private renderErrorHtml(req: UGReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'user.group',
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
 * Body fields for the user_group ADD form. Mirrors
 * application/admin/view/user/group/add.html — 3 form-groups: name, rules,
 * status. (No pid: fa_user_group is a flat list, not a tree.)
 */
function buildUserGroupFormFields(): string {
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Rules</label>
  <div class="col-xs-12 col-sm-8"><textarea name="row[rules]" class="form-control" rows="3" placeholder="Comma-separated rule ids"></textarea></div>
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
 * Body fields for the user_group EDIT form. Mirrors the add layout but
 * prefills inputs from the row and marks the selected radio.
 */
function buildUserGroupEditFormFields(opts: { row: UserGroupEntity }): string {
  const row = opts.row
  const status = String(row.status ?? 'normal')
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;" value="${escapeHtml(row.name)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Rules</label>
  <div class="col-xs-12 col-sm-8"><textarea name="row[rules]" class="form-control" rows="3" placeholder="Comma-separated rule ids">${escapeHtml(row.rules ?? '')}</textarea></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal"${status === 'normal' ? ' checked' : ''}> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"${status === 'hidden' ? ' checked' : ''}> Hidden</label>
  </div>
</div>`
}
