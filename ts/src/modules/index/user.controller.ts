// index/User — frontend user-center: login/register/profile/changepwd/logout/attachment.
// Mirrors application/index/controller/User.php.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import type { Request, Response } from 'express'
import { UserEntity } from '../../entities/user.entity.ts'
import { AttachmentEntity } from '../../entities/attachment.entity.ts'
import { AuthService } from '../../services/auth.service.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { HookService } from '../../services/hook.service.ts'
import { ViewService } from '../../services/view.service.ts'
import { BackendConfigService } from '../../services/backend-config.service.ts'
import { FrontendAuthGuard } from '../../guards/frontend-auth.guard.ts'
import { fastadminHash, randomSalt } from '../../common/hash.ts'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'

interface FrontendUserReq extends Request {
  session: SessionWithToken & Record<string, unknown>
  user?: { id: number; username: string }
}

const USERNAME_RE = /^.{3,30}$/
const PASSWORD_RE = /^[\S]{6,30}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_RE = /^1\d{10}$/

@Controller('index/user')
export class FrontendUserController {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(AttachmentEntity) private readonly atts: Repository<AttachmentEntity>,
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    private readonly hooks: HookService,
    private readonly view: ViewService,
    private readonly backendConfig: BackendConfigService,
  ) {}

  /** Builds requireConfig for a frontend user/* action. */
  private requireConfig(req: FrontendUserReq, action: string): string {
    return JSON.stringify(this.backendConfig.buildSync(req, {
      controllername: 'user',
      actionname: action,
    }))
  }

  // -------- index (user center) --------
  @Get('index')
  @UseGuards(FrontendAuthGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  index(@Req() req: FrontendUserReq): string {
    return this.view.render({
      module: 'index',
      template: 'user/index',
      data: { title: 'User center', username: req.user?.username ?? '', requireConfig: this.requireConfig(req, 'index') },
    })
  }

  // -------- register --------
  @Get('register')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getRegister(@Req() req: FrontendUserReq): string {
    const tok = this.csrf.issue(req.session)
    return this.view.render({
      module: 'index',
      template: 'user/register',
      data: { title: 'Register', __token__: tok, requireConfig: this.requireConfig(req, 'register') },
    })
  }

  @Post('register')
  @HttpCode(200)
  async postRegister(
    @Req() req: FrontendUserReq,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return apiErr('Token verification error')
    }
    const username = String(body['username'] ?? '').trim()
    const password = String(body['password'] ?? '')
    const email = String(body['email'] ?? '').trim()
    const mobile = String(body['mobile'] ?? '').trim()
    if (!USERNAME_RE.test(username)) return apiErr('Username must be 3 to 30 characters')
    if (!PASSWORD_RE.test(password)) return apiErr('Password must be 6 to 30 characters')
    if (!EMAIL_RE.test(email)) return apiErr('Email is incorrect')
    if (mobile && !MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    const result = await this.auth.register({ username, password, email, mobile })
    if (!result.ok || !result.user || !result.token) {
      const map: Record<string, string> = {
        username_exists: 'Username already exists',
        email_exists: 'Email already exists',
        mobile_exists: 'Mobile already exists',
        invalid_params: 'Invalid parameters',
      }
      return apiErr(map[result.error ?? ''] ?? 'Register failed')
    }
    await this.hooks.listen('user_register_successed', { user: result.user, token: result.token, res })
    setLoginCookies(res, result.user.id, result.token)
    return apiOk('Sign up successful', { userinfo: { id: result.user.id, username: result.user.username } })
  }

  // -------- login --------
  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getLogin(@Req() req: FrontendUserReq): string {
    const tok = this.csrf.issue(req.session)
    return this.view.render({
      module: 'index',
      template: 'user/login',
      data: { title: 'Login', __token__: tok, requireConfig: this.requireConfig(req, 'login') },
    })
  }

  @Post('login')
  @HttpCode(200)
  async postLogin(
    @Req() req: FrontendUserReq,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return apiErr('Token verification error')
    }
    const account = String(body['account'] ?? '').trim()
    const password = String(body['password'] ?? '')
    if (account.length < 3 || account.length > 50) return apiErr('Account must be 3 to 50 characters')
    if (!PASSWORD_RE.test(password)) return apiErr('Password must be 6 to 30 characters')
    const r = await this.auth.login(account, password)
    if (!r.ok || !r.user || !r.token) {
      const map: Record<string, string> = {
        account_not_found: 'Account does not exist',
        account_locked: 'Account locked',
        password_incorrect: 'Password incorrect',
      }
      return apiErr(map[r.error ?? ''] ?? 'Login failed')
    }
    await this.hooks.listen('user_login_successed', { user: r.user, token: r.token, res })
    setLoginCookies(res, r.user.id, r.token)
    return apiOk('Logged in successful', { userinfo: { id: r.user.id, username: r.user.username, token: r.token } })
  }

  // -------- logout --------
  @Get('logout')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getLogout(@Req() req: FrontendUserReq): string {
    const tok = this.csrf.issue(req.session)
    return `<!doctype html><html><body>
<form id="logout_submit" method="POST" action="/index/user/logout">
  <input type="hidden" name="__token__" value="${tok}">
</form><script>document.getElementById('logout_submit').submit();</script>
</body></html>`
  }

  @Post('logout')
  @HttpCode(200)
  async postLogout(
    @Req() req: FrontendUserReq,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return apiErr('Token verification error')
    }
    const token = String(req.cookies?.['token'] ?? '')
    if (token) await this.auth.logout(token)
    await this.hooks.listen('user_logout_successed', { res })
    res.clearCookie('uid')
    res.clearCookie('token')
    return apiOk('Logout successful')
  }

  // -------- profile (HTML only). --------
  @Get('profile')
  @UseGuards(FrontendAuthGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  profile(@Req() req: FrontendUserReq): string {
    const tok = this.csrf.issue(req.session)
    return this.view.render({
      module: 'index',
      template: 'user/profile',
      data: { title: 'Profile', username: req.user?.username ?? '', __token__: tok, requireConfig: this.requireConfig(req, 'profile') },
    })
  }

  // -------- changepwd --------
  @Get('changepwd')
  @UseGuards(FrontendAuthGuard)
  @Header('Content-Type', 'text/html; charset=utf-8')
  getChangepwd(@Req() req: FrontendUserReq): string {
    const tok = this.csrf.issue(req.session)
    return this.view.render({
      module: 'index',
      template: 'user/changepwd',
      data: { title: 'Change password', __token__: tok, requireConfig: this.requireConfig(req, 'changepwd') },
    })
  }

  @Post('changepwd')
  @HttpCode(200)
  @UseGuards(FrontendAuthGuard)
  async postChangepwd(
    @Req() req: FrontendUserReq,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<unknown>> {
    if (!this.csrf.consume(req.session, String(body['__token__'] ?? ''))) {
      return apiErr('Token verification error')
    }
    const oldPw = String(body['oldpassword'] ?? '')
    const newPw = String(body['newpassword'] ?? '')
    const reNewPw = String(body['renewpassword'] ?? '')
    if (!PASSWORD_RE.test(oldPw)) return apiErr('Old password is invalid')
    if (!PASSWORD_RE.test(newPw)) return apiErr('New password is invalid')
    if (newPw !== reNewPw) return apiErr("Password and confirm password don't match")
    const me = await this.users.findOneBy({ id: req.user?.id ?? 0 })
    if (!me) return apiErr('User not found')
    if (fastadminHash(oldPw, me.salt) !== me.password) return apiErr('Old password incorrect')
    const salt = randomSalt()
    await this.users.update({ id: me.id }, {
      salt,
      password: fastadminHash(newPw, salt),
      updatetime: Math.floor(Date.now() / 1000),
    })
    return apiOk('Reset password successful')
  }

  // -------- attachment (own uploads). --------
  @Get('attachment')
  @UseGuards(FrontendAuthGuard)
  async attachment(
    @Req() req: FrontendUserReq,
    @Query() q: Record<string, unknown>,
  ): Promise<unknown> {
    const meId = req.user?.id ?? 0
    if (!isAjax(req)) {
      return `<!doctype html><html><body><div id="attachment-list">${meId}</div></body></html>`
    }
    const limit = Math.max(1, parseInt(String(q.limit ?? '10'), 10) || 10)
    const offset = Math.max(0, parseInt(String(q.offset ?? '0'), 10) || 0)
    const qb = this.atts.createQueryBuilder('a').where('a.user_id = :u', { u: meId })
    const total = await qb.getCount()
    qb.orderBy('a.id', 'DESC').skip(offset).take(limit)
    const rows = await qb.getMany()
    return { total, rows }
  }
}

function isAjax(req: Request): boolean {
  return String(req.headers['x-requested-with'] ?? '').toLowerCase() === 'xmlhttprequest'
}

function setLoginCookies(res: Response, uid: number, token: string): void {
  // Mirror PHP Cookie::set: simple cookies, default 30-day lifetime.
  const maxAge = 30 * 24 * 60 * 60 * 1000
  res.cookie('uid', String(uid), { maxAge, httpOnly: false })
  res.cookie('token', token, { maxAge, httpOnly: false })
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
