// admin/auth/Adminlog — read-only listing of fa_admin_log + del.
// Mirrors application/admin/controller/auth/Adminlog.php.
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
import { Repository, In, Not, Like } from 'typeorm'
import type { Request } from 'express'
import { AdminLogEntity } from '../../entities/admin-log.entity.ts'
import { AuthGroupEntity } from '../../entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from '../../entities/auth-group-access.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { ViewService } from '../../services/view.service.ts'

interface AdminlogSession {
  admin?: { id: number; username: string } | undefined
}
type AdminlogReq = Request & { session: AdminlogSession & { [k: string]: unknown } }

@Controller('admin.php/auth/adminlog')
@UseGuards(AdminAuthGuard)
export class AuthAdminlogController {
  constructor(
    @InjectRepository(AdminLogEntity) private readonly logs: Repository<AdminLogEntity>,
    @InjectRepository(AuthGroupEntity) private readonly groups: Repository<AuthGroupEntity>,
    @InjectRepository(AuthGroupAccessEntity) private readonly access: Repository<AuthGroupAccessEntity>,
    private readonly view: ViewService,
  ) {}

  // -------- index. --------
  @Get('index')
  async indexGet(
    @Req() req: AdminlogReq,
    @Query() q: Record<string, string>,
  ): Promise<unknown> {
    if (!isAjax(req)) return this.renderListHtml(req)
    return this.indexAjax(req, q)
  }

  private async indexAjax(req: AdminlogReq, q: Record<string, string>): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)

    const limit = Math.max(1, parseInt(String(q.limit ?? '10'), 10) || 10)
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
    const offset = (page - 1) * limit
    const sort = /^[a-zA-Z0-9_]+$/.test(String(q.sort ?? '')) ? String(q.sort) : 'id'
    const order = (String(q.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC'

    const qb = this.logs.createQueryBuilder('l')

    // Search across id/title/url/username.
    const search = String(q.search ?? '').trim()
    if (search) {
      qb.andWhere(
        '(l.id LIKE :s OR l.title LIKE :s OR l.url LIKE :s OR l.username LIKE :s)',
        { s: `%${search}%` },
      )
    }

    let filter: Record<string, unknown> = {}
    let op: Record<string, unknown> = {}
    try { filter = q.filter ? JSON.parse(String(q.filter)) : {} } catch { /* ignore */ }
    try { op = q.op ? JSON.parse(String(q.op)) : {} } catch { /* ignore */ }

    for (const [k, v] of Object.entries(filter)) {
      if (!/^[a-zA-Z0-9_]+$/.test(k)) continue
      const sym = String(op[k] ?? '=').toUpperCase()
      const paramKey = `f_${k}`
      if (sym === 'LIKE') {
        qb.andWhere(`l.${k} LIKE :${paramKey}`, { [paramKey]: `%${v}%` })
      } else if (sym === '<>') {
        qb.andWhere(`l.${k} <> :${paramKey}`, { [paramKey]: v })
      } else {
        qb.andWhere(`l.${k} = :${paramKey}`, { [paramKey]: v })
      }
    }

    if (!isSuper) {
      const childIds = await this.childrenAdminIds(meId)
      qb.andWhere('l.admin_id IN (:...cids)', { cids: childIds.length > 0 ? childIds : [-1] })
    }

    const total = await qb.getCount()
    qb.orderBy(`l.${sort}`, order).skip(offset).take(limit)
    // Exclude content/useragent (PHP `field('content,useragent', true)` excludes them).
    qb.select(['l.id', 'l.admin_id', 'l.username', 'l.url', 'l.title', 'l.ip', 'l.createtime'])
    const rows = await qb.getRawMany() as Array<Record<string, unknown>>
    // Strip `l_` prefix from raw column names.
    const cleaned = rows.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) out[k.replace(/^l_/, '')] = v
      return out
    })
    return { total, rows: cleaned }
  }

  // -------- detail. --------
  @Get('detail/ids/:id')
  async detailPath(
    @Req() req: AdminlogReq,
    @Param('id') idStr: string,
  ): Promise<unknown> {
    return this.detailImpl(req, parseInt(idStr, 10))
  }

  private async detailImpl(req: AdminlogReq, id: number): Promise<unknown> {
    if (!Number.isFinite(id) || id <= 0) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    const row = await this.logs.findOneBy({ id })
    if (!row) {
      return isAjax(req) ? adminErr('No Results were found') : this.renderErrorHtml(req, 'No Results were found')
    }
    if (isAjax(req)) {
      return adminOk('', row)
    }
    return `<!doctype html><html><body>
<div class="detail">
  <div><b>URL:</b> ${escapeHtml(row.url ?? '')}</div>
  <div><b>Title:</b> ${escapeHtml(row.title ?? '')}</div>
  <div><b>Content:</b> ${escapeHtml(row.content ?? '')}</div>
</div></body></html>`
  }

  // -------- add (forbidden). --------
  @Get('add')
  @HttpCode(200)
  addGet(): AdminEnvelope<unknown> {
    return adminErr('')
  }
  @Post('add')
  @HttpCode(200)
  addPost(): AdminEnvelope<unknown> {
    return adminErr('')
  }

  // -------- edit (forbidden). --------
  @Get('edit')
  @HttpCode(200)
  editGet(): AdminEnvelope<unknown> {
    return adminErr('')
  }
  @Get('edit/ids/:id')
  @HttpCode(200)
  editGetPath(): AdminEnvelope<unknown> {
    return adminErr('')
  }
  @Post('edit')
  @HttpCode(200)
  editPost(): AdminEnvelope<unknown> {
    return adminErr('')
  }
  // PHP-style edit URL: `/admin.php/auth/adminlog/edit/ids/<id>` — adminlog
  // is read-only, so this matches the form-action shape and stays forbidden.
  @Post('edit/ids/:id')
  @HttpCode(200)
  editPostPath(): AdminEnvelope<unknown> {
    return adminErr('')
  }

  // -------- multi (forbidden). --------
  @Get('multi')
  @HttpCode(200)
  multiGet(): AdminEnvelope<unknown> {
    return adminErr('')
  }
  @Post('multi')
  @HttpCode(200)
  multiPost(): AdminEnvelope<unknown> {
    return adminErr('')
  }

  // -------- del. --------
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
  async del(
    @Req() req: AdminlogReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const ids = String(body['ids'] ?? '').trim()
    if (!ids) return adminErr('Parameter %s can not be empty')
    const idArr = ids.split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0)
    if (idArr.length === 0) return adminErr('Parameter %s can not be empty')

    const meId = req.session.admin?.id ?? 0
    const isSuper = await this.isSuperAdmin(meId)
    const qb = this.logs.createQueryBuilder('l').where('l.id IN (:...ids)', { ids: idArr })
    if (!isSuper) {
      const childIds = await this.childrenAdminIds(meId)
      qb.andWhere('l.admin_id IN (:...cids)', { cids: childIds.length > 0 ? childIds : [-1] })
    }
    const targets = await qb.getMany()
    if (targets.length === 0) return adminErr('No rows were deleted')
    await this.logs.delete({ id: In(targets.map((t) => t.id)) })
    return adminOk('')
  }

  // -------- helpers --------
  private async isSuperAdmin(adminId: number): Promise<boolean> {
    const rows = await this.access.find({ where: { uid: adminId } })
    if (rows.length === 0) return false
    const grp = await this.groups.findOne({ where: { id: In(rows.map((r) => r.group_id)), rules: '*' } })
    return !!grp
  }

  private async childrenAdminIds(adminId: number): Promise<number[]> {
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
    const groupIds = Array.from(out)
    if (groupIds.length === 0) return []
    const access = await this.access.find({ where: { group_id: In(groupIds) } })
    return Array.from(new Set(access.map((a) => a.uid)))
  }

  private renderListHtml(req: AdminlogReq): string {
    return this.view.renderListPage({
      pageTitle: 'Admin Log',
      tableId: 'table',
      indexUrl: '/admin.php/auth/adminlog/index',
      delUrl: '/admin.php/auth/adminlog/del',
      req,
      controllername: 'auth.adminlog',
      actionname: 'index',
      columns: [
        { checkbox: true },
        { field: 'id', title: 'ID', sortable: true },
        { field: 'admin_id', title: 'Admin ID' },
        { field: 'username', title: 'Username' },
        { field: 'url', title: 'URL' },
        { field: 'title', title: 'Title' },
        { field: 'content', title: 'Content' },
        { field: 'ip', title: 'IP' },
        { field: 'createtime', title: 'Time', formatter: 'Table.api.formatter.datetime' },
      ],
    })
  }

  private renderErrorHtml(req: AdminlogReq, msg: string): string {
    return this.view.renderDetailPage({
      pageTitle: 'Error',
      body: `<div class="alert alert-danger error">${escapeHtml(msg)}</div>`,
      req,
      controllername: 'auth.adminlog',
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
