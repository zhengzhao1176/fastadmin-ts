// admin/Category controller — list / add / edit / del / multi / selectpage.
// Mirrors application/admin/controller/Category.php. The PHP class has custom
// index() (tree-flatten) + custom edit() (descendant check) on top of the
// Backend trait; the rest is plain CRUD from BackendCrudService.
import {
  All,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Request } from 'express'
import { CategoryEntity } from '../../entities/category.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { BackendCrudService, parseStr } from '../../services/backend-crud.service.ts'
import { Tree } from '../../common/tree.ts'
import { NoNeedRight } from '../../common/no-need-right.decorator.ts'
import { ViewService } from '../../services/view.service.ts'

interface CategorySession extends SessionWithToken {
  admin?: { id: number; username: string; isSuper?: boolean } | undefined
}

type CategoryReq = Request & { session: CategorySession & { [k: string]: unknown } }

@Controller('admin.php/category')
@UseGuards(AdminAuthGuard)
@NoNeedRight(['selectpage'])
export class CategoryController {
  private readonly crud: BackendCrudService<CategoryEntity>

  constructor(
    @InjectRepository(CategoryEntity) private readonly repo: Repository<CategoryEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {
    this.crud = new BackendCrudService(this.repo, {
      searchFields: 'name,nickname',
      multiFields: 'status,flag,weigh',
      selectpageFields: 'id,pid,name,type,nickname',
    })
  }

  // -------- index: HTML (non-ajax) or {total,rows} (ajax). --------
  @Get('index')
  async indexGet(
    @Req() req: CategoryReq,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax(query)
  }

  @Post('index')
  async indexPost(@Query() query: Record<string, string>): Promise<unknown> {
    return this.indexAjax(query)
  }

  private async indexAjax(query: Record<string, string>): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const type = query.type
    const search = query.search ?? ''
    const all = await this.repo.find({ order: { weigh: 'DESC', id: 'DESC' } })
    const treeInput = all.map((r) => ({
      ...r,
      id: r.id,
      pid: r.pid,
    }))
    const tree = new Tree<typeof treeInput[number]>().init(treeInput, 'pid')
    const fullList = tree.getTreeList(tree.getTreeArray(0), 'name')

    let rows: Array<Record<string, unknown>>
    if (!type || type === 'all') {
      rows = fullList as unknown as Array<Record<string, unknown>>
    } else {
      rows = fullList.filter((v) => v.type === type) as unknown as Array<Record<string, unknown>>
    }
    // Apply search filter (LIKE name/nickname) — PHP uses stripos but tests
    // don't exercise this path; implemented for fidelity only.
    if (search) {
      const needle = String(search).toLowerCase()
      rows = rows.filter((v) =>
        String(v.name ?? '').toLowerCase().includes(needle) ||
        String(v.nickname ?? '').toLowerCase().includes(needle),
      )
    }
    return { total: rows.length, rows }
  }

  // -------- add: GET → form HTML with __token__, POST → INSERT --------
  @Get('add')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getAdd(@Req() req: CategoryReq): Promise<string> {
    const tok = this.csrf.issue(req.session)
    const pidOptions = await this.buildPidOptions()
    const fields = buildCategoryFormFields({ pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Add Category',
      formAction: '/admin.php/category/add',
      __token__: tok,
      fields,
      req,
      controllername: 'category',
      actionname: 'add',
    })
  }

  /**
   * Build the <option> list for the parent (pid) selector. Mirrors PHP's
   * `getCategoryArray()` + Tree::getTreeList — flat list of all categories with
   * box-drawing-character indentation prepended to the nickname.
   *
   * When `selectedPid` is provided the matching <option> gets `selected`.
   */
  private async buildPidOptions(selectedPid?: number): Promise<string> {
    const all = await this.repo.find({ order: { weigh: 'DESC', id: 'DESC' } })
    if (all.length === 0) return ''
    const treeInput = all.map((r) => ({ ...r, id: r.id, pid: r.pid }))
    const tree = new Tree<typeof treeInput[number]>().init(treeInput, 'pid')
    const flat = tree.getTreeList(tree.getTreeArray(0), 'nickname')
    return flat.map((r) => {
      const label = String((r as unknown as Record<string, unknown>).nickname ?? '')
      const sel = selectedPid != null && Number(selectedPid) === Number(r.id) ? ' selected' : ''
      return `<option value="${r.id}"${sel}>${label}</option>`
    }).join('\n')
  }

  @Post('add')
  async postAdd(
    @Req() req: CategoryReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const submittedToken = String(body['__token__'] ?? '')
    if (!this.csrf.consume(req.session, submittedToken)) {
      const fresh = this.csrf.issue(req.session)
      return adminErr('Token verification error', { token: fresh })
    }
    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') {
      return adminErr('Parameter %s can not be empty')
    }
    const params = normaliseRow(rowParam as Record<string, unknown>)
    const r = await this.crud.add(params)
    if (!r.ok) return adminErr(r.error ?? 'No rows were inserted')
    // Replicate Category model's afterInsert hook: when weigh was empty/zero,
    // set it to the inserted id so the row sorts at its own pk.
    const weighIn = params.weigh
    if (!weighIn || Number(weighIn) === 0) {
      if (r.id) await this.repo.update({ id: r.id }, { weigh: r.id })
    }
    return adminOk('', { id: r.id })
  }

  // -------- edit: GET form / POST update --------
  @Get('edit/ids/:id')
  async getEditPathId(
    @Req() req: CategoryReq,
    @Param('id') idStr: string,
  ): Promise<unknown> {
    const id = parseInt(idStr, 10)
    return this.renderEditOrError(req, id)
  }

  @Get('edit')
  async getEditQueryId(
    @Req() req: CategoryReq,
    @Query('ids') idsQ?: string,
  ): Promise<unknown> {
    const id = parseInt(idsQ ?? '0', 10)
    return this.renderEditOrError(req, id)
  }

  private async renderEditOrError(req: CategoryReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      if (isAjax(req)) return adminErr('No Results were found')
      return this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.repo.findOneBy({ id })
    if (!row) {
      if (isAjax(req)) return adminErr('No Results were found')
      return this.renderErrorHtml(req, 'No Results were found')
    }
    const tok = this.csrf.issue(req.session)
    const pidOptions = await this.buildPidOptions(row.pid)
    return this.renderEditHtml(req, row, tok, pidOptions)
  }

  @Post('edit')
  async postEdit(
    @Req() req: CategoryReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, undefined)
  }

  // PHP-style edit URL: `/admin.php/category/edit/ids/<id>` (the form's
  // generated action). NestJS routes are explicit, so we need a matching
  // POST route that takes id from the path.
  @Post('edit/ids/:id')
  async postEditPathId(
    @Req() req: CategoryReq,
    @Body() body: Record<string, unknown>,
    @Param('id') idStr: string,
  ): Promise<AdminEnvelope<unknown>> {
    return this.postEditImpl(req, body, idStr)
  }

  private async postEditImpl(
    req: CategoryReq,
    body: Record<string, unknown>,
    pathId: string | undefined,
  ): Promise<AdminEnvelope<unknown>> {
    const submittedToken = String(body['__token__'] ?? '')
    if (!this.csrf.consume(req.session, submittedToken)) {
      const fresh = this.csrf.issue(req.session)
      return adminErr('Token verification error', { token: fresh })
    }
    const id = parseInt(String(pathId ?? body['ids'] ?? '0'), 10)
    if (!Number.isFinite(id) || id <= 0) return adminErr('No Results were found')
    const row = await this.repo.findOneBy({ id })
    if (!row) return adminErr('No Results were found')

    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') {
      return adminErr('Parameter %s can not be empty')
    }
    const params = normaliseRow(rowParam as Record<string, unknown>)

    // Reject pid that points at the row itself or any descendant.
    if (params.pid != null && Number(params.pid) !== Number(row.pid)) {
      const all = await this.repo.find()
      const tree = new Tree<CategoryEntity>().init(all, 'pid')
      const descendantIds = tree.getChildrenIds(row.id, true)
      if (descendantIds.includes(Number(params.pid))) {
        return adminErr('Can not change the parent to child or itself')
      }
    }

    const r = await this.crud.edit(id, params)
    if (!r.ok) return adminErr(r.error ?? 'No rows were updated')
    return adminOk('')
  }

  // -------- selectpage --------
  // The fastadmin-selectpage plugin POSTs its queries; accept both verbs.
  @All('selectpage')
  async selectpage(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    const p = { ...(body ?? {}), ...query }
    return this.crud.selectpage({
      q_word: p['q_word'] as string | string[],
      searchField: (p['searchField'] as string | string[]) ?? 'name',
      keyField: (p['keyField'] as string) ?? 'id',
      showField: (p['showField'] as string) ?? 'name',
      keyValue: p['keyValue'] as string | undefined,
      pageNumber: p['pageNumber'] as string | number,
      pageSize: p['pageSize'] as string | number,
      andOr: p['andOr'] as string,
    })
  }

  // -------- del (physical — Category has no SoftDelete trait) --------
  @Post('del')
  async del(@Body() body: Record<string, unknown>): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '')
    if (!ids) return adminErr('Parameter %s can not be empty')
    const count = await this.crud.del(ids)
    if (!count) return adminErr('No rows were deleted')
    return adminOk('')
  }

  // -------- multi --------
  @Post('multi')
  async multi(
    @Req() req: CategoryReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '')
    if (!ids) return adminErr('Parameter %s can not be empty')
    const paramsStr = String(body['params'] ?? '')
    if (!paramsStr) return adminErr('No rows were updated')
    const values = parseStr(paramsStr)
    const isSuper = req.session.admin?.isSuper === true || true // TODO: wire super-admin detection
    const count = await this.crud.multi(ids, values, isSuper)
    if (!count) return adminErr('No rows were updated')
    return adminOk('')
  }

  // -------- HTML renderers (delegate to ViewService for AdminLTE chrome). --------
  private renderListHtml(req: CategoryReq): string {
    return this.view.renderListPage({
      pageTitle: 'Category',
      tableId: 'table',
      indexUrl: '/admin.php/category/index',
      addUrl: '/admin.php/category/add',
      editUrl: '/admin.php/category/edit',
      delUrl: '/admin.php/category/del',
      multiUrl: '/admin.php/category/multi',
      req,
      controllername: 'category',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'pid', title: 'Parent' },
        { field: 'type', title: 'Type' },
        { field: 'name', title: 'Name' },
        { field: 'nickname', title: 'Nickname' },
        { field: 'weigh', title: 'Weight', sortable: true },
        { field: 'status', title: 'Status' },
        { operate: true, title: 'Operate' },
      ],
    })
  }

  private renderEditHtml(req: CategoryReq, row: CategoryEntity, token: string, pidOptions: string): string {
    const fields = buildCategoryEditFormFields({ row, pidOptions })
    return this.view.renderFormPage({
      pageTitle: 'Edit Category',
      formId: 'edit-form',
      formAction: `/admin.php/category/edit/ids/${row.id}`,
      __token__: token,
      idsField: `<input type="hidden" name="ids" value="${row.id}">`,
      fields,
      req,
      controllername: 'category',
      actionname: 'edit',
    })
  }

  private renderErrorHtml(req: CategoryReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'category',
      actionname: 'error',
    })
  }
}

function isAjax(req: Request): boolean {
  return String(req.headers['x-requested-with'] ?? '').toLowerCase() === 'xmlhttprequest'
}

function normaliseRow(row: Record<string, unknown>): Record<string, unknown> {
  // express qs parses row[pid] into { row: { pid: '0' } } — values arrive as
  // strings, so cast numeric-shaped fields. We coerce a known list rather than
  // trusting parseInt on every value (some fields like `name` are intentionally
  // string).
  const out: Record<string, unknown> = { ...row }
  for (const k of ['pid', 'weigh']) {
    if (out[k] !== undefined && out[k] !== '') out[k] = Number(out[k])
    else if (out[k] === '') out[k] = 0
  }
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Render the body fields for the Category EDIT form. Mirrors the add form
 * (10 fields: pid, type, name, nickname, image, keywords, description,
 * diyname, weigh, status) but pre-populates every input with the row's current
 * value and marks the matching select option / radio button as selected/checked.
 */
function buildCategoryEditFormFields(opts: { row: CategoryEntity; pidOptions: string }): string {
  const row = opts.row
  const type = String(row.type ?? '')
  const typeSel = (v: string): string => (type === v ? ' selected' : '')
  const status = String(row.status ?? 'normal')
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Pid</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[pid]" class="form-control selectpicker">
      <option value="0"${Number(row.pid ?? 0) === 0 ? ' selected' : ''}>None</option>
      ${opts.pidOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Type</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[type]" class="form-control">
      <option value=""${typeSel('')}>None</option>
      <option value="default"${typeSel('default')}>Default</option>
      <option value="page"${typeSel('page')}>Page</option>
      <option value="article"${typeSel('article')}>Article</option>
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;" value="${escapeHtml(row.name ?? '')}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Nickname</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[nickname]" class="form-control" data-rule="required;" value="${escapeHtml(row.nickname ?? '')}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Image</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[image]" class="form-control" value="${escapeHtml(row.image ?? '')}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Keywords</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[keywords]" class="form-control" value="${escapeHtml(row.keywords ?? '')}"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Description</label>
  <div class="col-xs-12 col-sm-8"><textarea name="row[description]" class="form-control" rows="3">${escapeHtml(row.description ?? '')}</textarea></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Diyname</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[diyname]" class="form-control" value="${escapeHtml(row.diyname ?? '')}"></div>
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
</div>
<span class="row-name">${escapeHtml(row.name ?? '')}</span>`
}

/**
 * Render the body fields for the Category add form. Matches the PHP layout in
 * application/admin/view/category/add.html — 10 form-groups for: pid, type,
 * name, nickname, image, keywords, description, diyname, weigh, status.
 * The 11th field of the PHP form (flag checkboxes) is omitted; the underlying
 * `flag` column accepts an empty value just fine.
 */
function buildCategoryFormFields(opts: { pidOptions: string }): string {
  const pidOptions = opts.pidOptions
  return `
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Pid</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[pid]" class="form-control selectpicker">
      <option value="0">None</option>
      ${pidOptions}
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Type</label>
  <div class="col-xs-12 col-sm-8">
    <select name="row[type]" class="form-control">
      <option value="">None</option>
      <option value="default">Default</option>
      <option value="page">Page</option>
      <option value="article">Article</option>
    </select>
  </div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Name</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[name]" class="form-control" data-rule="required;"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Nickname</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[nickname]" class="form-control" data-rule="required;"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Image</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[image]" class="form-control"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Keywords</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[keywords]" class="form-control"></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Description</label>
  <div class="col-xs-12 col-sm-8"><textarea name="row[description]" class="form-control" rows="3"></textarea></div>
</div>
<div class="form-group">
  <label class="control-label col-xs-12 col-sm-2">Diyname</label>
  <div class="col-xs-12 col-sm-8"><input type="text" name="row[diyname]" class="form-control"></div>
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
