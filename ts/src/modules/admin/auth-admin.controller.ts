// admin/auth/Admin — admin user management.
// Mirrors application/admin/controller/auth/Admin.php. Implements the
// "super-admin sees everyone, subadmin sees children" split via group_id=1
// = super shortcut (the PHP version walks the auth_group tree).
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
import { Repository, In, Not, DataSource } from 'typeorm'
import type { Request } from 'express'
import { AdminEntity } from '../../entities/admin.entity.ts'
import { AuthGroupEntity } from '../../entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from '../../entities/auth-group-access.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { fastadminHash, randomSalt } from '../../common/hash.ts'
import { NoNeedRight } from '../../common/no-need-right.decorator.ts'
import { ViewService } from '../../services/view.service.ts'

interface AdminSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type AdminReq = Request & { session: AdminSession & { [k: string]: unknown } }

const USERNAME_RE = /^\w{3,30}$/
const PASSWORD_RE = /^[\S]{6,30}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_RE = /^1[3-9]\d{9}$/

@Controller('admin.php/auth/admin')
@UseGuards(AdminAuthGuard)
@NoNeedRight(['selectpage'])
export class AuthAdminController {
  constructor(
    @InjectRepository(AdminEntity) private readonly admins: Repository<AdminEntity>,
    @InjectRepository(AuthGroupEntity) private readonly groups: Repository<AuthGroupEntity>,
    @InjectRepository(AuthGroupAccessEntity) private readonly access: Repository<AuthGroupAccessEntity>,
    private readonly csrf: CsrfService,
    private readonly dataSource: DataSource,
    private readonly view: ViewService,
  ) {}

  // -------- index. --------
  @Get('index')
  async indexGet(
    @Req() req: AdminReq,
    @Query() q: Record<string, string>,
  ): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax(req, q)
  }

  private async indexAjax(req: AdminReq, q: Record<string, string>): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)
    const childrenIds = await this.childrenAdminIds(meId, isSuper)

    const limit = Math.max(1, parseInt(String(q.limit ?? '10'), 10) || 10)
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
    const offset = (page - 1) * limit
    const sort = /^[a-zA-Z0-9_]+$/.test(String(q.sort ?? '')) ? String(q.sort) : 'id'
    const order = (String(q.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC'

    const qb = this.admins.createQueryBuilder('a')
      .where('a.id IN (:...ids)', { ids: childrenIds.length > 0 ? childrenIds : [-1] })

    const search = String(q.search ?? '').trim()
    if (search) {
      qb.andWhere(
        '(a.id LIKE :s OR a.username LIKE :s OR a.nickname LIKE :s)',
        { s: `%${search}%` },
      )
    }
    const total = await qb.getCount()
    qb.orderBy(`a.${sort}`, order).skip(offset).take(limit)
    const rows = await qb.getMany()

    // Strip password/salt/token from each row.
    const stripped = rows.map((r) => {
      const { password: _p, salt: _s, token: _t, ...rest } = r
      return rest as Record<string, unknown>
    })
    return { total, rows: stripped }
  }

  // -------- add. --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAdd(@Req() req: AdminReq): string {
    const tok = this.csrf.issue(req.session)
    const fields = `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Group</label>
  <div class="col-xs-12 col-sm-8">
    <select name="group[]" class="form-control selectpicker" multiple data-rule="required">
      <option value="1">Admin Group</option>
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Username</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[username]" data-rule="required;username"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Email</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="email" name="row[email]" data-rule="required;email"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Mobile</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[mobile]" data-rule="mobile"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Nickname</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[nickname]" data-rule="required"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Password</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="password" name="row[password]" autocomplete="new-password" data-rule="required;password"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Avatar</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[avatar]"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal" checked> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"> Hidden</label>
  </div>
</div>`
    return this.view.renderFormPage({
      pageTitle: 'Admin - Add',
      formId: 'add-form',
      formAction: '/admin.php/auth/admin/add',
      __token__: tok,
      fields,
      req,
      controllername: 'auth.admin',
      actionname: 'add',
    })
  }

  @Post('add')
  @HttpCode(200)
  async postAdd(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const row = body['row']
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) {
      return adminErr('Parameter %s can not be empty')
    }
    const r = row as Record<string, unknown>
    const username = String(r.username ?? '').trim()
    const nickname = String(r.nickname ?? '').trim()
    const password = String(r.password ?? '')
    const email = String(r.email ?? '').trim()
    const mobile = String(r.mobile ?? '').trim()

    if (!USERNAME_RE.test(username)) return adminErr('Please input correct username')
    if (!PASSWORD_RE.test(password)) return adminErr('Please input correct password')
    if (!EMAIL_RE.test(email)) return adminErr('Please input correct email')
    if (mobile && !MOBILE_RE.test(mobile)) return adminErr('Please input correct mobile')

    // Uniqueness check.
    if (await this.admins.findOneBy({ username })) return adminErr('Username already exists')
    if (await this.admins.findOneBy({ email })) return adminErr('Email already exists')
    if (mobile && await this.admins.findOneBy({ mobile })) return adminErr('Mobile already exists')

    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)
    const childrenGroupIds = await this.childrenGroupIds(meId, isSuper)
    const groupRaw = body['group']
    const requestedGroups = (Array.isArray(groupRaw) ? groupRaw : groupRaw != null ? [groupRaw] : [])
      .map((g) => Number(g)).filter((g) => Number.isFinite(g) && g > 0)
    const validGroups = requestedGroups.filter((g) => childrenGroupIds.includes(g))
    if (validGroups.length === 0) return adminErr('The parent group exceeds permission limit')

    const salt = randomSalt()
    const now = Math.floor(Date.now() / 1000)
    try {
      const insert = await this.admins.save(this.admins.create({
        username,
        nickname,
        password: fastadminHash(password, salt),
        salt,
        email,
        mobile,
        avatar: '/assets/img/avatar.png',
        status: String(r.status ?? 'normal'),
        createtime: now,
        updatetime: now,
      }))
      for (const gid of validGroups) {
        await this.access.save(this.access.create({ uid: insert.id, group_id: gid }))
      }
      return adminOk('', { id: insert.id })
    } catch (e) {
      return adminErr((e as Error).message)
    }
  }

  // -------- edit. --------
  @Get('edit/ids/:id')
  async getEditPathId(
    @Req() req: AdminReq,
    @Param('id') idStr: string,
  ): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idStr, 10))
  }

  @Get('edit')
  async getEdit(
    @Req() req: AdminReq,
    @Query('ids') idsQ?: string,
  ): Promise<unknown> {
    return this.renderEditOrError(req, parseInt(idsQ ?? '0', 10))
  }

  private async renderEditOrError(req: AdminReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.admins.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    return this.renderEditHtml(req, row, tok)
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/auth/admin/edit/ids/<id>` (the form's
  // generated action). NestJS routes are explicit, so we need a matching
  // POST route that takes id from the path.
  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPathId(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, idStr)
  }

  private async postEditImpl(
    req: AdminReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const id = parseInt(String(pathId ?? body['ids'] ?? '0'), 10)
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')

    const row = await this.admins.findOneBy({ id })
    if (!row) return adminErr('No Results were found')

    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)
    const childrenIds = await this.childrenAdminIds(meId, isSuper)
    if (!childrenIds.includes(id)) return adminErr('You have no permission')

    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('Parameter %s can not be empty')
    const r = rowParam as Record<string, unknown>

    const username = String(r.username ?? '').trim()
    const nickname = String(r.nickname ?? '').trim()
    const password = String(r.password ?? '')
    const email = String(r.email ?? '').trim()
    const mobile = String(r.mobile ?? '').trim()

    if (!USERNAME_RE.test(username)) return adminErr('Please input correct username')
    if (!EMAIL_RE.test(email)) return adminErr('Please input correct email')
    if (mobile && !MOBILE_RE.test(mobile)) return adminErr('Please input correct mobile')

    // Uniqueness check (excluding self).
    const usernameTaken = await this.admins.findOne({ where: { username, id: Not(id) } })
    if (usernameTaken) return adminErr('Username already exists')
    const emailTaken = await this.admins.findOne({ where: { email, id: Not(id) } })
    if (emailTaken) return adminErr('Email already exists')
    if (mobile) {
      const mobileTaken = await this.admins.findOne({ where: { mobile, id: Not(id) } })
      if (mobileTaken) return adminErr('Mobile already exists')
    }

    const updateBag: Partial<AdminEntity> = {
      username,
      nickname,
      email,
      mobile,
      status: String(r.status ?? row.status),
      updatetime: Math.floor(Date.now() / 1000),
    }
    if (password) {
      if (!PASSWORD_RE.test(password)) return adminErr('Please input correct password')
      const salt = randomSalt()
      updateBag.salt = salt
      updateBag.password = fastadminHash(password, salt)
    }
    await this.admins.update({ id }, updateBag)

    // Replace auth_group_access rows.
    const childrenGroupIds = await this.childrenGroupIds(meId, isSuper)
    const groupRaw = body['group']
    const requestedGroups = (Array.isArray(groupRaw) ? groupRaw : groupRaw != null ? [groupRaw] : [])
      .map((g) => Number(g)).filter((g) => Number.isFinite(g) && g > 0)
    const validGroups = requestedGroups.filter((g) => childrenGroupIds.includes(g))
    if (validGroups.length === 0) return adminErr('The parent group exceeds permission limit')

    await this.access.delete({ uid: id })
    for (const gid of validGroups) {
      await this.access.save(this.access.create({ uid: id, group_id: gid }))
    }
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
  async postDel(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (idArr.length === 0) return adminErr('Parameter %s can not be empty')

    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)
    const childrenIds = await this.childrenAdminIds(meId, isSuper)
    let scoped = idArr.filter((id) => childrenIds.includes(id))
    // Never allow deleting self.
    scoped = scoped.filter((id) => id !== meId)
    if (scoped.length === 0) return adminErr('You have no permission')

    await this.admins.delete({ id: In(scoped) })
    await this.access.delete({ uid: In(scoped) })
    return adminOk('')
  }

  // -------- multi: forbidden. --------
  @Post('multi')
  @HttpCode(200)
  multi(): AdminEnvelope<unknown> {
    return adminErr('')
  }

  // -------- selectpage. --------
  @Post('selectpage')
  @HttpCode(200)
  async postSelectpage(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
  ): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    return this.selectpageImpl(req, body)
  }

  @Get('selectpage')
  async getSelectpage(
    @Req() req: AdminReq,
    @Query() q: Record<string, unknown>,
  ): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    return this.selectpageImpl(req, q)
  }

  private async selectpageImpl(
    req: AdminReq,
    params: Record<string, unknown>,
  ): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)
    const childrenIds = await this.childrenAdminIds(meId, isSuper)
    const pageNumber = Math.max(1, parseInt(String(params['pageNumber'] ?? '1'), 10) || 1)
    const pageSize = Math.max(1, parseInt(String(params['pageSize'] ?? '10'), 10) || 10)
    const offset = (pageNumber - 1) * pageSize
    const keyField = String(params['keyField'] ?? 'id')
    const showField = String(params['showField'] ?? 'nickname')
    const qb = this.admins.createQueryBuilder('a')
      .where('a.id IN (:...ids)', { ids: childrenIds.length > 0 ? childrenIds : [-1] })
    const total = await qb.getCount()
    qb.skip(offset).take(pageSize)
    const rows = await qb.getMany()
    const list = rows.map((r) => {
      const rec = r as unknown as Record<string, unknown>
      return {
        [keyField]: rec[keyField] ?? '',
        [showField]: rec[showField] ?? '',
        pid: 0,
      }
    })
    return { list, total }
  }

  // -------- helpers --------
  /** super = belongs to a group whose rules='*' (group 1 in the seed). */
  private async isSuperAdmin(adminId: number): Promise<boolean> {
    const rows = await this.access.find({ where: { uid: adminId } })
    if (rows.length === 0) return false
    const groupIds = rows.map((r) => r.group_id)
    const grp = await this.groups.findOne({ where: { id: In(groupIds), rules: '*' } })
    return !!grp
  }

  /**
   * Admin ids the caller can manage. Super: all admins. Non-super: admins
   * who belong to any group that descends from the caller's groups (excl. self).
   */
  private async childrenAdminIds(adminId: number, isSuper: boolean): Promise<number[]> {
    if (isSuper) {
      const all = await this.admins.find({ select: ['id'] })
      return all.map((a) => a.id)
    }
    const childGroups = await this.childrenGroupIds(adminId, false)
    if (childGroups.length === 0) return []
    const access = await this.access.find({ where: { group_id: In(childGroups) } })
    const ids = Array.from(new Set(access.map((a) => a.uid)))
    return ids.filter((id) => id !== adminId)
  }

  /**
   * Group ids descending from the caller's groups (and the caller's own
   * groups). Super returns all groups.
   */
  private async childrenGroupIds(adminId: number, isSuper: boolean): Promise<number[]> {
    if (isSuper) {
      const all = await this.groups.find({ select: ['id'] })
      return all.map((g) => g.id)
    }
    const myAccess = await this.access.find({ where: { uid: adminId } })
    const myGroupIds = myAccess.map((a) => a.group_id)
    if (myGroupIds.length === 0) return []
    const allGroups = await this.groups.find()
    const out = new Set<number>(myGroupIds)
    let frontier = [...myGroupIds]
    while (frontier.length > 0) {
      const next: number[] = []
      for (const g of allGroups) {
        if (frontier.includes(g.pid) && !out.has(g.id)) {
          out.add(g.id)
          next.push(g.id)
        }
      }
      frontier = next
    }
    return Array.from(out)
  }

  private renderListHtml(req: AdminReq): string {
    return this.view.renderListPage({
      pageTitle: 'Admin',
      tableId: 'table',
      indexUrl: '/admin.php/auth/admin/index',
      addUrl: '/admin.php/auth/admin/add',
      editUrl: '/admin.php/auth/admin/edit',
      delUrl: '/admin.php/auth/admin/del',
      req,
      controllername: 'auth.admin',
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

  private renderEditHtml(req: AdminReq, row: AdminEntity, token: string): string {
    const status = String(row.status ?? 'normal')
    const fields = `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Group</label>
  <div class="col-xs-12 col-sm-8">
    <select name="group[]" class="form-control selectpicker" multiple data-rule="required">
      <option value="1">Admin Group</option>
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Username</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[username]" value="${escapeHtml(row.username)}" data-rule="required;username"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Email</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="email" name="row[email]" value="${escapeHtml(row.email)}" data-rule="required;email"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Mobile</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[mobile]" value="${escapeHtml(row.mobile)}" data-rule="mobile"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Nickname</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[nickname]" value="${escapeHtml(row.nickname)}" data-rule="required"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Password</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="password" name="row[password]" value="" autocomplete="new-password" placeholder="Leave blank to keep current password"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Avatar</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="text" name="row[avatar]" value="${escapeHtml(row.avatar ?? '')}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Loginfailure</label>
  <div class="col-xs-12 col-sm-8"><input class="form-control" type="number" name="row[loginfailure]" value="${escapeHtml(String((row as unknown as Record<string, unknown>).loginfailure ?? 0))}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal"${status === 'normal' ? ' checked' : ''}> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"${status === 'hidden' ? ' checked' : ''}> Hidden</label>
  </div>
</div>`
    return this.view.renderFormPage({
      pageTitle: 'Admin - Edit',
      formId: 'edit-form',
      formAction: `/admin.php/auth/admin/edit/ids/${row.id}`,
      __token__: token,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'auth.admin',
      actionname: 'edit',
    })
  }

  private renderErrorHtml(req: AdminReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'auth.admin',
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
