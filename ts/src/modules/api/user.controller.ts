import {
  All,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { ApiAuthGuard } from '../../guards/api-auth.guard.ts'
import { AuthService } from '../../services/auth.service.ts'
import { CaptchaService } from '../../services/captcha.service.ts'
import type { UserEntity } from '../../entities/user.entity.ts'

interface Userinfo {
  id: number
  username: string
  nickname: string
  mobile: string
  avatar: string
  score: number
  token: string
  user_id: number
  createtime: number
  expiretime: number
  expires_in: number
}

const MOBILE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PW_RE = /^\S{6,30}$/

function buildUserinfo(u: UserEntity, token: string, expiresIn: number): Userinfo {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    mobile: u.mobile,
    avatar: u.avatar,
    score: u.score,
    token,
    user_id: u.id,
    createtime: now,
    expiretime: now + expiresIn,
    expires_in: expiresIn,
  }
}

@Controller('api/user')
export class ApiUserController {
  constructor(
    private readonly auth: AuthService,
    private readonly captcha: CaptchaService,
  ) {}

  @Post('login')
  async login(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<{ userinfo: Userinfo } | null>> {
    const account = String(body['account'] ?? '').trim()
    const password = String(body['password'] ?? '')
    if (!account || !password) return apiErr('Invalid parameters')
    const r = await this.auth.login(account, password)
    if (!r.ok || !r.user || !r.token) {
      const msg = r.error === 'account_not_found' ? '账户不正确'
        : r.error === 'account_locked' ? '账户已经被锁定'
        : '密码不正确'
      return apiErr(msg)
    }
    return apiOk('登录成功', { userinfo: buildUserinfo(r.user, r.token, r.expires_in ?? 0) })
  }

  @Post('mobilelogin')
  async mobilelogin(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<{ userinfo: Userinfo } | null>> {
    const mobile = String(body['mobile'] ?? '').trim()
    const captcha = String(body['captcha'] ?? '').trim()
    if (!mobile || !captcha) return apiErr('Invalid parameters')
    if (!MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    if (!await this.captcha.checkSms(mobile, captcha, 'mobilelogin')) {
      return apiErr('Captcha is incorrect')
    }
    const existing = await this.auth.findByMobile(mobile)
    if (existing) {
      if (existing.status !== 'normal') return apiErr('账户已经被锁定')
      const issued = await this.auth.issueToken(existing.id)
      await this.captcha.flushSms(mobile, 'mobilelogin')
      return apiOk('登录成功', { userinfo: buildUserinfo(existing, issued.token, issued.expiresIn) })
    }
    const r = await this.auth.register({ username: mobile, password: Math.random().toString(36).slice(2, 12), mobile })
    if (!r.ok || !r.user || !r.token) return apiErr('Operation failed')
    await this.captcha.flushSms(mobile, 'mobilelogin')
    return apiOk('登录成功', { userinfo: buildUserinfo(r.user, r.token, r.expires_in ?? 0) })
  }

  @Post('register')
  async register(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<{ userinfo: Userinfo } | null>> {
    const username = String(body['username'] ?? '').trim()
    const password = String(body['password'] ?? '')
    const email = String(body['email'] ?? '').trim()
    const mobile = String(body['mobile'] ?? '').trim()
    const code = String(body['code'] ?? '').trim()

    if (!username || !password) return apiErr('Invalid parameters')
    if (email && !EMAIL_RE.test(email)) return apiErr('Email is incorrect')
    if (mobile && !MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    if (!await this.captcha.checkSms(mobile, code, 'register')) {
      return apiErr('Captcha is incorrect')
    }
    const r = await this.auth.register({ username, password, email, mobile })
    if (!r.ok || !r.user || !r.token) {
      const msg = r.error === 'username_exists' ? 'Username already exist'
        : r.error === 'nickname_exists' ? 'Nickname already exist'
        : r.error === 'email_exists' ? 'Email already exist'
        : r.error === 'mobile_exists' ? 'Mobile already exist'
        : 'Operation failed'
      return apiErr(msg)
    }
    return apiOk('Sign up successful', { userinfo: buildUserinfo(r.user, r.token, r.expires_in ?? 0) })
  }

  @Post('logout')
  @UseGuards(ApiAuthGuard)
  async logout(@Req() req: Request & { rawToken?: string }): Promise<ApiEnvelope<null>> {
    await this.auth.logout(req.rawToken ?? '')
    return apiOk('退出成功', null)
  }

  @All('index')
  @UseGuards(ApiAuthGuard)
  index(@Req() req: Request & { user?: UserEntity }): ApiEnvelope<{ welcome: string }> {
    return apiOk('', { welcome: req.user?.nickname ?? '' })
  }

  @Post('profile')
  @UseGuards(ApiAuthGuard)
  async profile(
    @Req() req: Request & { user?: UserEntity },
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<null>> {
    const me = req.user!
    const nickname = body['nickname'] != null ? String(body['nickname']).trim() : undefined
    const username = body['username'] != null ? String(body['username']).trim() : undefined
    const avatar = body['avatar'] != null ? String(body['avatar']) : undefined
    if (username && username !== me.username && await this.auth.usernameTaken(username, me.id)) {
      return apiErr('Username already exists')
    }
    if (nickname && nickname !== me.nickname && await this.auth.nicknameTaken(nickname, me.id)) {
      return apiErr('Nickname already exists')
    }
    const patch: Partial<UserEntity> = {}
    if (username !== undefined) patch.username = username
    if (nickname !== undefined) patch.nickname = nickname
    if (avatar !== undefined) patch.avatar = avatar
    await this.auth.updateUser(me.id, patch)
    return apiOk('', null)
  }

  @Post('changeemail')
  @UseGuards(ApiAuthGuard)
  async changeemail(
    @Req() req: Request & { user?: UserEntity },
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<null>> {
    const me = req.user!
    const email = String(body['email'] ?? '').trim()
    const captcha = String(body['captcha'] ?? '').trim()
    if (!email || !captcha) return apiErr('Invalid parameters')
    if (!EMAIL_RE.test(email)) return apiErr('Email is incorrect')
    if (await this.auth.emailTaken(email, me.id)) return apiErr('Email already exists')
    if (!await this.captcha.checkEms(email, captcha, 'changeemail')) {
      return apiErr('Captcha is incorrect')
    }
    await this.auth.updateUser(me.id, { email })
    await this.captcha.flushEms(email, 'changeemail')
    return apiOk('', null)
  }

  @Post('changemobile')
  @UseGuards(ApiAuthGuard)
  async changemobile(
    @Req() req: Request & { user?: UserEntity },
    @Body() body: Record<string, unknown>,
  ): Promise<ApiEnvelope<null>> {
    const me = req.user!
    const mobile = String(body['mobile'] ?? '').trim()
    const captcha = String(body['captcha'] ?? '').trim()
    if (!mobile || !captcha) return apiErr('Invalid parameters')
    if (!MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    if (await this.auth.mobileTaken(mobile, me.id)) return apiErr('Mobile already exists')
    if (!await this.captcha.checkSms(mobile, captcha, 'changemobile')) {
      return apiErr('Captcha is incorrect')
    }
    await this.auth.updateUser(me.id, { mobile })
    await this.captcha.flushSms(mobile, 'changemobile')
    return apiOk('', null)
  }

  @Post('resetpwd')
  async resetpwd(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const type = String(body['type'] ?? 'mobile')
    const newpassword = String(body['newpassword'] ?? '')
    const captcha = String(body['captcha'] ?? '').trim()
    if (!newpassword || !captcha) return apiErr('Invalid parameters')
    if (!PW_RE.test(newpassword)) return apiErr('Password must be 6 to 30 characters')

    if (type === 'mobile') {
      const mobile = String(body['mobile'] ?? '').trim()
      if (!MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
      const user = await this.auth.findByMobile(mobile)
      if (!user) return apiErr('User not found')
      if (!await this.captcha.checkSms(mobile, captcha, 'resetpwd')) {
        return apiErr('Captcha is incorrect')
      }
      await this.auth.resetPassword(user.id, newpassword)
      await this.captcha.flushSms(mobile, 'resetpwd')
    } else {
      const email = String(body['email'] ?? '').trim()
      if (!EMAIL_RE.test(email)) return apiErr('Email is incorrect')
      const user = await this.auth.findByEmail(email)
      if (!user) return apiErr('User not found')
      if (!await this.captcha.checkEms(email, captcha, 'resetpwd')) {
        return apiErr('Captcha is incorrect')
      }
      await this.auth.resetPassword(user.id, newpassword)
      await this.captcha.flushEms(email, 'resetpwd')
    }
    return apiOk('Reset password successful', null)
  }

  @Post('third')
  third(): ApiEnvelope<null> {
    return apiErr('Invalid parameters')
  }
}
