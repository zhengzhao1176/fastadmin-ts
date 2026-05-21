// admin/general/Profile — self-service profile editing for the logged-in admin.
// PHP whitelist: email / nickname / password / avatar. No oldpassword check.
import { Body, Controller, Get, Header, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Not } from 'typeorm'
import type { Request } from 'express'
import { AdminEntity } from '../../entities/admin.entity.ts'
import { AdminLogEntity } from '../../entities/admin-log.entity.ts'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { ViewService } from '../../services/view.service.ts'
import { fastadminHash, randomSalt } from '../../common/hash.ts'

interface ProfileSession extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}

type ProfileReq = Request & { session: ProfileSession & { [k: string]: unknown } }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_RE = /^[\S]{6,30}$/

@Controller('admin.php/general/profile')
@UseGuards(AdminAuthGuard)
export class GeneralProfileController {
  constructor(
    @InjectRepository(AdminEntity) private readonly admins: Repository<AdminEntity>,
    @InjectRepository(AdminLogEntity) private readonly logs: Repository<AdminLogEntity>,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
  ) {}

  // GET → HTML; POST ajax → {total, rows} (own admin_log entries).
  @Get('index')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getIndex(@Req() req: ProfileReq): string {
    const tok = this.csrf.issue(req.session)
    return this.view.renderFormPage({
      pageTitle: 'Profile',
      formAction: '/admin.php/general/profile/update',
      __token__: tok,
      fields: `
  <div class="form-group"><label class="col-xs-2 control-label">Email</label><div class="col-xs-8"><input class="form-control" type="email" name="row[email]"></div></div>
  <div class="form-group"><label class="col-xs-2 control-label">Nickname</label><div class="col-xs-8"><input class="form-control" type="text" name="row[nickname]"></div></div>
  <div class="form-group"><label class="col-xs-2 control-label">Avatar</label><div class="col-xs-8"><input class="form-control" type="text" name="row[avatar]"></div></div>
  <div class="form-group"><label class="col-xs-2 control-label">Password</label><div class="col-xs-8"><input class="form-control" type="password" name="row[password]"></div></div>`,
      req,
      controllername: 'general.profile',
      actionname: 'index',
    })
  }

  @Post('index')
  @HttpCode(200)
  async postIndex(@Req() req: ProfileReq): Promise<{ total: number; rows: AdminLogEntity[] }> {
    const adminId = req.session.admin?.id ?? 0
    const [rows, total] = await this.logs.findAndCount({
      where: { admin_id: adminId },
      order: { id: 'DESC' },
      take: 10,
    })
    return { total, rows }
  }

  // GET update → no-op (200, no envelope). POST update → mutate admin row.
  @Get('update')
  getUpdate(): string {
    return ''
  }

  @Post('update')
  @HttpCode(200)
  async postUpdate(
    @Req() req: ProfileReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<unknown>> {
    const submittedToken = String(body['__token__'] ?? '')
    if (!this.csrf.consume(req.session, submittedToken)) {
      const fresh = this.csrf.issue(req.session)
      return adminErr('Token verification error', { token: fresh })
    }
    const meId = req.session.admin?.id
    if (!meId) return adminErr('请登录')

    const rowParam = body['row']
    if (!rowParam || typeof rowParam !== 'object') return adminErr('')
    const r = rowParam as Record<string, unknown>

    // PHP `array_intersect_key` whitelist then `array_filter` (drops empties).
    const allowed: Record<string, string> = {}
    for (const k of ['email', 'nickname', 'password', 'avatar']) {
      const v = r[k]
      if (v != null && String(v).length > 0) allowed[k] = String(v)
    }

    if (!allowed.email || !EMAIL_RE.test(allowed.email)) {
      return adminErr('Please input correct email')
    }
    if (allowed.password != null) {
      if (!PASSWORD_RE.test(allowed.password)) {
        return adminErr('Please input correct password')
      }
    }

    const taken = await this.admins.findOne({
      where: { email: allowed.email, id: Not(meId) },
    })
    if (taken) return adminErr('Email already exists')

    const me = await this.admins.findOneBy({ id: meId })
    if (!me) return adminErr('No Results were found')

    const updateBag: Partial<AdminEntity> = {}
    if (allowed.email != null) updateBag.email = allowed.email
    if (allowed.nickname != null) updateBag.nickname = allowed.nickname
    if (allowed.avatar != null) updateBag.avatar = allowed.avatar
    if (allowed.password != null) {
      const salt = randomSalt()
      updateBag.salt = salt
      updateBag.password = fastadminHash(allowed.password, salt)
    }
    updateBag.updatetime = Math.floor(Date.now() / 1000)
    await this.admins.update({ id: meId }, updateBag)
    return adminOk('')
  }
}
