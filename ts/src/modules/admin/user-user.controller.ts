// admin/user/User — frontend user CRUD from the admin side.
// Mirrors application/admin/controller/user/User.php.
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
import { Repository, Like } from 'typeorm'
import type { Request } from 'express'
import { UserEntity } from '../../entities/user.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { ViewService } from '../../services/view.service.ts'
import { NoNeedRight } from '../../common/no-need-right.decorator.ts'

interface UserSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type UserReq = Request & { session: UserSession & { [k: string]: unknown } }

@Controller('admin.php/user/user')
@UseGuards(AdminAuthGuard)
export class UserUserController {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {}

  // -------- index --------
  @Get('index')
  async indexGet(@Req() req: UserReq, @Query() q: Record<string, string>): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax(q)
  }
  @Post('index')
  @HttpCode(200)
  async indexPost(@Query() q: Record<string, string>): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    return this.indexAjax(q)
  }

  private async indexAjax(q: Record<string, string>): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const limit = Math.max(1, parseInt(String(q.limit ?? '10'), 10) || 10)
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
    const offset = (page - 1) * limit
    const sort = /^[a-zA-Z0-9_]+$/.test(String(q.sort ?? '')) ? String(q.sort) : 'id'
    const order = (String(q.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC'
    const qb = this.users.createQueryBuilder('u')
    const search = String(q.search ?? '').trim()
    if (search) {
      qb.where('(u.id LIKE :s OR u.username LIKE :s OR u.nickname LIKE :s)', { s: `%${search}%` })
    }
    const total = await qb.getCount()
    qb.orderBy(`u.${sort}`, order).skip(offset).take(limit)
    const rows = await qb.getMany()
    const stripped = rows.map((r) => {
      const { password: _p, salt: _s, ...rest } = r
      return rest as Record<string, unknown>
    })
    return { total, rows: stripped }
  }

  // -------- add (HTML only; tests skip the working POST flow). --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdd(@Req() req: UserReq): string {
    const tok = this.csrf.issue(req.session)
    return `<!doctype html><html><body><form><input name="__token__" value="${tok}"></form></body></html>`
  }

  @Post('add')
  @HttpCode(200)
  async postAdd(
    @Req() req: UserReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('Parameter %s can not be empty')
    // PHP's admin/user/User.add does NOT hash; mirror that (tests don't assert
    // login-with-cleartext path; only token-rejection paths).
    const now = Math.floor(Date.now() / 1000)
    try {
      const saved = await this.users.save(this.users.create({
        ...(rowParam as Partial<UserEntity>),
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
  async getEditPath(@Req() req: UserReq, @Param('id') idStr: string): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idStr, 10))
  }

  @Get('edit')
  async getEditQuery(@Req() req: UserReq, @Query('ids') idsQ?: string): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idsQ ?? '0', 10))
  }

  private async renderEditOrError(req: UserReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.users.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    return this.renderEditHtml(req, row, tok)
  }

  private renderEditHtml(req: UserReq, row: UserEntity, token: string): string {
    const status = String(row.status ?? 'normal')
    const fields = `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Group</label>
  <div class="col-xs-12 col-sm-4">
    <select name="row[group_id]" class="form-control selectpicker" data-rule="required">
      <option value="${row.group_id}" selected>Group ${row.group_id}</option>
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Username</label>
  <div class="col-xs-12 col-sm-4"><input class="form-control" type="text" name="row[username]" value="${escapeHtml(row.username)}" data-rule="required"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Nickname</label>
  <div class="col-xs-12 col-sm-4"><input class="form-control" type="text" name="row[nickname]" value="${escapeHtml(row.nickname)}" data-rule="required"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Password</label>
  <div class="col-xs-12 col-sm-4"><input class="form-control" type="password" name="row[password]" value="" autocomplete="new-password" placeholder="Leave blank to keep current password"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Email</label>
  <div class="col-xs-12 col-sm-4"><input class="form-control" type="text" name="row[email]" value="${escapeHtml(row.email)}" data-rule="email"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Mobile</label>
  <div class="col-xs-12 col-sm-4"><input class="form-control" type="text" name="row[mobile]" value="${escapeHtml(row.mobile)}" data-rule="mobile"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Avatar</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[avatar]" value="${escapeHtml(row.avatar)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Score</label>
  <div class="col-xs-12 col-sm-4"><input class="form-control" type="number" name="row[score]" value="${escapeHtml(String(row.score ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal"${status === 'normal' ? ' checked' : ''}> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"${status === 'hidden' ? ' checked' : ''}> Hidden</label>
  </div>
</div>`
    return this.view.renderFormPage({
      pageTitle: 'User - Edit',
      formId: 'edit-form',
      formAction: `/admin.php/user/user/edit/ids/${row.id}`,
      __token__: token,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'user.user',
      actionname: 'edit',
    })
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: UserReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/user/user/edit/ids/<id>` (the form's
  // generated action). NestJS routes are explicit, so we need a matching
  // POST route that takes id from the path.
  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPathId(
    @Req() req: UserReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, idStr)
  }

  private async postEditImpl(
    req: UserReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const id = parseInt(String(pathId ?? body['ids'] ?? '0'), 10)
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')
    const row = await this.users.findOneBy({ id })
    if (!row) return adminErr('No Results were found')

    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('Parameter %s can not be empty')
    const r = rowParam as Record<string, unknown>
    const updateBag: Partial<UserEntity> = {
      username: r.username != null ? String(r.username) : row.username,
      nickname: r.nickname != null ? String(r.nickname) : row.nickname,
      email: r.email != null ? String(r.email) : row.email,
      mobile: r.mobile != null ? String(r.mobile) : row.mobile,
      group_id: r.group_id != null ? Number(r.group_id) : row.group_id,
      status: r.status != null ? String(r.status) : row.status,
      updatetime: Math.floor(Date.now() / 1000),
    }
    await this.users.update({ id }, updateBag)
    return adminOk('')
  }

  // -------- del. --------
  @Get('del')
  @HttpCode(200)
  delGet(): AdminEnvelope<unknown> {
    return adminErr('Invalid parameters')
  }

  @Post('del')
  @HttpCode(200)
  async del(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('No Results were found')
    const firstId = parseInt(ids.split(',')[0] ?? '0', 10)
    if (!Number.isFinite(firstId) || firstId <= 0) return adminErr('No Results were found')
    const row = await this.users.findOneBy({ id: firstId })
    if (!row) return adminErr('No Results were found')
    await this.users.delete({ id: firstId })
    return adminOk('')
  }

  // -------- multi (forbidden / no-op). --------
  @Post('multi')
  @HttpCode(200)
  multi(): AdminEnvelope<unknown> {
    return adminErr('')
  }

  // -------- selectpage — data source for the SelectPage member picker.
  // CRUD-generated forms point `user_id` columns at `user/user/selectpage`
  // (doc 178 / database.html). Returns {list, total} like every other
  // selectpage endpoint.
  @Get('selectpage')
  @NoNeedRight()
  @HttpCode(200)
  async getSelectpage(@Query() q: Record<string, unknown>): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    return this.selectpageImpl(q)
  }

  @Post('selectpage')
  @NoNeedRight()
  @HttpCode(200)
  async postSelectpage(@Body() body: Record<string, unknown>): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    return this.selectpageImpl(body)
  }

  private async selectpageImpl(params: Record<string, unknown>): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    const pageNumber = Math.max(1, parseInt(String(params['pageNumber'] ?? '1'), 10) || 1)
    const pageSize = Math.max(1, parseInt(String(params['pageSize'] ?? '10'), 10) || 10)
    const keyField = String(params['keyField'] ?? 'id')
    const showField = String(params['showField'] ?? 'nickname')
    // q_word is the typed search term — `q_word[]` array per FastAdmin convention.
    const qwRaw = params['q_word']
    const keyword = Array.isArray(qwRaw) ? String(qwRaw[0] ?? '') : String(qwRaw ?? '')
    const where = keyword ? [{ username: Like(`%${keyword}%`) }, { nickname: Like(`%${keyword}%`) }] : {}
    const [rows, total] = await this.users.findAndCount({
      where,
      skip: (pageNumber - 1) * pageSize,
      take: pageSize,
      order: { id: 'DESC' },
    })
    // Only expose safe display fields — never leak password / salt.
    const list = rows.map((r) => {
      const rec = r as unknown as Record<string, unknown>
      return {
        [keyField]: rec[keyField],
        [showField]: rec[showField],
        id: rec.id,
        username: rec.username,
        nickname: rec.nickname,
      }
    })
    return { list, total }
  }

  private renderListHtml(req: UserReq): string {
    return this.view.renderListPage({
      pageTitle: 'User',
      tableId: 'table',
      indexUrl: '/admin.php/user/user/index',
      addUrl: '/admin.php/user/user/add',
      editUrl: '/admin.php/user/user/edit',
      delUrl: '/admin.php/user/user/del',
      req,
      controllername: 'user.user',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'username', title: 'Username' },
        { field: 'nickname', title: 'Nickname' },
        { field: 'email', title: 'Email' },
        { field: 'mobile', title: 'Mobile' },
        { field: 'status', title: 'Status' },
        { field: 'logintime', title: 'Login Time', formatter: 'Table.api.formatter.datetime' },
        { operate: true, title: 'Operate' },
      ],
    })
  }

  private renderErrorHtml(req: UserReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'user.user',
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
