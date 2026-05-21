// admin/auth/Group — auth_group CRUD with rule-cascading on edit.
// Mirrors application/admin/controller/auth/Group.php.
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
import { AuthGroupEntity } from '../../entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from '../../entities/auth-group-access.entity.ts'
import { AuthRuleEntity } from '../../entities/auth-rule.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { Tree } from '../../common/tree.ts'
import { NoNeedRight } from '../../common/no-need-right.decorator.ts'
import { ViewService } from '../../services/view.service.ts'

interface GroupSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}
type GroupReq = Request & { session: GroupSession & { [k: string]: unknown } }

@Controller('admin.php/auth/group')
@UseGuards(AdminAuthGuard)
@NoNeedRight(['roletree'])
export class AuthGroupController {
  constructor(
    @InjectRepository(AuthGroupEntity) private readonly groups: Repository<AuthGroupEntity>,
    @InjectRepository(AuthGroupAccessEntity) private readonly access: Repository<AuthGroupAccessEntity>,
    @InjectRepository(AuthRuleEntity) private readonly rules: Repository<AuthRuleEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {}

  // -------- index. --------
  @Get('index')
  async indexGet(@Req() req: GroupReq): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax(req)
  }
  @Post('index')
  @HttpCode(200)
  async indexPost(@Req() req: GroupReq): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    return this.indexAjax(req)
  }

  private async indexAjax(req: GroupReq): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const meId = req.session.admin?.id ?? 0
    const childIds = await this.childrenGroupIds(meId)
    const groupRows = await this.groups.find({ where: { id: In(childIds.length ? childIds : [-1]) } })
    const tree = new Tree<AuthGroupEntity>().init(groupRows, 'pid')
    const list = tree.getTreeList(tree.getTreeArray(0), 'name') as unknown as Array<Record<string, unknown>>
    return { total: list.length, rows: list }
  }

  // -------- add. --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getAdd(@Req() req: GroupReq): Promise<string> {
    const tok = this.csrf.issue(req.session)
    const meId = req.session.admin?.id ?? 0
    const pidOptions = await this.buildPidOptions(meId)
    const fields = buildAuthGroupFormFields({ pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Add Group',
      formAction: '/admin.php/auth/group/add',
      __token__: tok,
      fields,
      req,
      controllername: 'auth.group',
      actionname: 'add',
    })
  }

  /**
   * Build <option> list for the pid selector. Limits options to groups the
   * caller is allowed to manage (super → all, otherwise self + descendants).
   */
  private async buildPidOptions(adminId: number, selectedPid?: number): Promise<string> {
    const childIds = await this.childrenGroupIds(adminId)
    if (childIds.length === 0) return ''
    const rows = await this.groups.find({ where: { id: In(childIds) } })
    const tree = new Tree<AuthGroupEntity>().init(rows, 'pid')
    const flat = tree.getTreeList(tree.getTreeArray(0), 'name')
    return flat.map((r) => {
      const label = String((r as unknown as Record<string, unknown>).name ?? '')
      const sel = selectedPid != null && Number(selectedPid) === Number(r.id) ? ' selected' : ''
      return `<option value="${r.id}"${sel}>${escapeHtml(label)}</option>`
    }).join('\n')
  }

  @Post('add')
  @HttpCode(200)
  async postAdd(
    @Req() req: GroupReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    const row = body['row']
    if (!row || typeof row !== 'object') return adminErr('Parameter %s can not be empty')
    const r = row as Record<string, unknown>
    const pid = parseInt(String(r.pid ?? '0'), 10)
    if (!Number.isFinite(pid) || pid <= 0) return adminErr('The parent group exceeds permission limit')

    const meId = req.session.admin?.id ?? 0
    const childGroupIds = await this.childrenGroupIds(meId)
    if (!childGroupIds.includes(pid)) return adminErr('The parent group exceeds permission limit')

    const parent = await this.groups.findOneBy({ id: pid })
    if (!parent) return adminErr('The parent group can not found')

    const requested = String(r.rules ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const parentRules = parent.rules.split(',').map((s) => s.trim())
    const currentRuleIds = await this.adminRuleIds(meId)
    let allowedRules = requested
    if (!parentRules.includes('*')) {
      allowedRules = allowedRules.filter((id) => parentRules.includes(id))
    }
    if (!currentRuleIds.includes('*')) {
      allowedRules = allowedRules.filter((id) => currentRuleIds.includes(id))
    }
    const now = Math.floor(Date.now() / 1000)
    const saved = await this.groups.save(this.groups.create({
      pid,
      name: String(r.name ?? '').trim(),
      rules: allowedRules.join(','),
      status: String(r.status ?? 'normal'),
      createtime: now,
      updatetime: now,
    }))
    return adminOk('', { id: saved.id })
  }

  // -------- edit. --------
  @Get('edit/ids/:id')
  async getEdit(@Req() req: GroupReq, @Param('id') idStr: string): Promise<unknown> {
    const id = parseInt(idStr, 10)
    return this.renderEditOrError(req, id)
  }

  @Post('edit/ids/:id')
  @HttpCode(200)
  async postEditPathId(
    @Req() req: GroupReq,
    @Param('id') idStr: string,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.editImpl(req, parseInt(idStr, 10), body)
  }

  @Post('edit')
  @HttpCode(200)
  async postEdit(
    @Req() req: GroupReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.editImpl(req, parseInt(String(body['ids'] ?? '0'), 10), body)
  }

  private async editImpl(
    req: GroupReq,
    id: number,
    body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return adminErr('Token verification error', { __token__: this.csrf.issue(req.session) })
    }
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')
    const meId = req.session.admin?.id ?? 0
    const childGroupIds = await this.childrenGroupIds(meId)
    if (!childGroupIds.includes(id)) return adminErr('You have no permission')

    const row = await this.groups.findOneBy({ id })
    if (!row) return adminErr('No Results were found')

    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('Parameter %s can not be empty')
    const r = rowParam as Record<string, unknown>
    const pid = parseInt(String(r.pid ?? '0'), 10)
    if (!Number.isFinite(pid) || pid <= 0) return adminErr('The parent group exceeds permission limit')
    if (!childGroupIds.includes(pid)) return adminErr('The parent group exceeds permission limit')

    // pid cannot be self or any descendant.
    const allGroups = await this.groups.find()
    const tree = new Tree<AuthGroupEntity>().init(allGroups, 'pid')
    const descendants = tree.getChildrenIds(id, true)
    if (descendants.includes(pid)) return adminErr('The parent group can not be its own child or itself')

    const parent = await this.groups.findOneBy({ id: pid })
    if (!parent) return adminErr('The parent group can not found')

    const requested = String(r.rules ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const parentRules = parent.rules.split(',').map((s) => s.trim())
    const currentRuleIds = await this.adminRuleIds(meId)
    let allowedRules = requested
    if (!parentRules.includes('*')) {
      allowedRules = allowedRules.filter((rid) => parentRules.includes(rid))
    }
    if (!currentRuleIds.includes('*')) {
      allowedRules = allowedRules.filter((rid) => currentRuleIds.includes(rid))
    }
    await this.groups.update({ id }, {
      pid,
      name: String(r.name ?? row.name).trim(),
      rules: allowedRules.join(','),
      status: String(r.status ?? row.status),
      updatetime: Math.floor(Date.now() / 1000),
    })

    // Cascade: every descendant's rules ∩ allowedRules.
    const tree2 = new Tree<AuthGroupEntity>().init(await this.groups.find(), 'pid')
    const descIds = tree2.getChildrenIds(id).filter((x) => x !== id)
    for (const dId of descIds) {
      const d = await this.groups.findOneBy({ id: dId })
      if (!d) continue
      const dRules = d.rules.split(',').map((s) => s.trim()).filter(Boolean)
      const intersected = dRules.filter((rid) => allowedRules.includes(rid))
      await this.groups.update({ id: dId }, { rules: intersected.join(',') })
    }
    return adminOk('')
  }

  private async renderEditOrError(req: GroupReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.groups.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    const meId = req.session.admin?.id ?? 0
    const pidOptions = await this.buildPidOptions(meId, row.pid)
    const fields = buildAuthGroupEditFormFields({ row, pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Edit Group',
      formId: 'edit-form',
      formAction: `/admin.php/auth/group/edit/ids/${row.id}`,
      __token__: tok,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'auth.group',
      actionname: 'edit',
    })
  }

  // -------- del. --------
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
  async del(
    @Req() req: GroupReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    let idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    const meId = req.session.admin?.id ?? 0

    // Exclude caller's own group(s).
    const myAccess = await this.access.find({ where: { uid: meId } })
    const myGroupIds = myAccess.map((a) => a.group_id)
    idArr = idArr.filter((id) => !myGroupIds.includes(id))

    // For each remaining id: if any admin belongs to it OR it has children, skip.
    const toDelete: number[] = []
    for (const id of idArr) {
      const hasAdmin = await this.access.findOneBy({ group_id: id })
      if (hasAdmin) continue
      const hasChild = await this.groups.findOneBy({ pid: id })
      if (hasChild) continue
      toDelete.push(id)
    }
    if (toDelete.length === 0) {
      return adminErr('You can not delete group that contain child group and administrators')
    }
    await this.groups.delete({ id: In(toDelete) })
    return adminOk('')
  }

  // -------- multi: forbidden. --------
  @Post('multi')
  @HttpCode(200)
  multi(): AdminEnvelope<unknown> {
    return adminErr('')
  }

  // -------- roletree (ztree-shape rules tree). --------
  @Post('roletree')
  @HttpCode(200)
  async roletree(
    @Req() req: GroupReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown> | unknown[]> {
    const id = parseInt(String(body['id'] ?? '0'), 10) || null
    const pid = parseInt(String(body['pid'] ?? '0'), 10)
    const parent = await this.groups.findOneBy({ id: pid })
    let current: AuthGroupEntity | null = null
    if (id) current = await this.groups.findOneBy({ id })

    if (!parent || (id && !current)) return adminErr('Group not found')

    // If editing (id provided), the proposed pid cannot be a descendant of id.
    if (id && current) {
      const allGroups = await this.groups.find()
      const tree = new Tree<AuthGroupEntity>().init(allGroups, 'pid')
      const descendants = tree.getChildrenIds(id, true)
      if (descendants.includes(pid)) return adminErr('Can not change the parent to child')
    }

    const allRules = await this.rules.find({ order: { weigh: 'DESC', id: 'ASC' } })
    const parentRuleIds = parent.rules.split(',').map((s) => s.trim()).filter(Boolean)
    const parentSelectable = parentRuleIds.includes('*')
      ? allRules
      : allRules.filter((r) => parentRuleIds.includes(String(r.id)))

    const ruleTree = new Tree<AuthRuleEntity>().init(parentSelectable, 'pid')
    const currentRuleIds = current ? current.rules.split(',').map((s) => s.trim()).filter(Boolean) : []

    const flatList = ruleTree.getTreeList(ruleTree.getTreeArray(0), 'title')
    const hasChildren = new Set(flatList.filter((v) => v.haschild).map((v) => v.id))
    const visibleIds = new Set(flatList.map((v) => v.id))

    const meId = req.session.admin?.id ?? 0
    const adminRuleIds = await this.adminRuleIds(meId)
    const isSuper = adminRuleIds.includes('*')

    const nodeList: Array<Record<string, unknown>> = []
    for (const v of flatList) {
      if (!isSuper && !adminRuleIds.includes(String(v.id))) continue
      if (v.pid && !visibleIds.has(Number(v.pid))) continue
      nodeList.push({
        id: v.id,
        parent: v.pid ? v.pid : '#',
        text: String(v.title ?? ''),
        type: 'menu',
        state: { selected: currentRuleIds.includes(String(v.id)) && !hasChildren.has(v.id) },
      })
    }
    return adminOk('', nodeList)
  }

  // -------- helpers --------
  private async isSuperAdmin(adminId: number): Promise<boolean> {
    const rows = await this.access.find({ where: { uid: adminId } })
    if (rows.length === 0) return false
    const groupIds = rows.map((r) => r.group_id)
    const grp = await this.groups.findOne({ where: { id: In(groupIds), rules: '*' } })
    return !!grp
  }

  private async childrenGroupIds(adminId: number): Promise<number[]> {
    if (await this.isSuperAdmin(adminId)) {
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

  private async adminRuleIds(adminId: number): Promise<string[]> {
    const myAccess = await this.access.find({ where: { uid: adminId } })
    if (myAccess.length === 0) return []
    const groupIds = myAccess.map((a) => a.group_id)
    const groupRows = await this.groups.find({ where: { id: In(groupIds) } })
    const ruleIds: string[] = []
    let hasStar = false
    for (const g of groupRows) {
      const parts = g.rules.split(',').map((s) => s.trim()).filter(Boolean)
      for (const p of parts) {
        if (p === '*') { hasStar = true } else ruleIds.push(p)
      }
    }
    return hasStar ? ['*', ...ruleIds] : ruleIds
  }

  private renderListHtml(req: GroupReq): string {
    this.csrf.issue(req.session)
    return this.view.renderListPage({
      pageTitle: 'Group',
      tableId: 'table',
      indexUrl: '/admin.php/auth/group/index',
      addUrl: '/admin.php/auth/group/add',
      editUrl: '/admin.php/auth/group/edit',
      delUrl: '/admin.php/auth/group/del',
      req,
      controllername: 'auth.group',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'name', title: 'Name' },
        { field: 'pid', title: 'Parent' },
        { field: 'status', title: 'Status' },
        { operate: true, title: 'Operate' },
      ],
    })
  }

  private renderErrorHtml(req: GroupReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'auth.group',
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
 * Body fields for the auth_group add form. Mirrors
 * application/admin/view/auth/group/add.html — 4 form-groups: pid, name, rules,
 * status. The rules field is rendered as a textarea (PHP uses a ztree picker
 * via /roletree; the textarea accepts the same comma-separated id list, which
 * the controller's postAdd already parses).
 */
function buildAuthGroupFormFields(opts: { pidOptions: string }): string {
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Parent</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[pid]" class="form-control selectpicker" data-rule="required">
      ${opts.pidOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Rules</label>
  <div class="col-xs-12 col-sm-8"><textarea name="row[rules]" class="form-control" rows="3" placeholder="Comma-separated rule ids, or * for all"></textarea></div>
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
 * Body fields for the auth_group EDIT form. Mirrors the add layout but
 * prefills inputs and marks selected radio/option values from the row.
 */
function buildAuthGroupEditFormFields(opts: { row: AuthGroupEntity; pidOptions: string }): string {
  const row = opts.row
  const status = String(row.status ?? 'normal')
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Parent</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[pid]" class="form-control selectpicker" data-rule="required">
      ${opts.pidOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;" value="${escapeHtml(row.name)}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Rules</label>
  <div class="col-xs-12 col-sm-8"><textarea name="row[rules]" class="form-control" rows="3" placeholder="Comma-separated rule ids, or * for all">${escapeHtml(row.rules ?? '')}</textarea></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Status</label>
  <div class="col-xs-12 col-sm-8">
    <label class="radio-inline"><input type="radio" name="row[status]" value="normal"${status === 'normal' ? ' checked' : ''}> Normal</label>
    <label class="radio-inline"><input type="radio" name="row[status]" value="hidden"${status === 'hidden' ? ' checked' : ''}> Hidden</label>
  </div>
</div>`
}
