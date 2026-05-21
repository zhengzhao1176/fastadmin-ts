import { Body, Controller, Post } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Not, Repository } from 'typeorm'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { UserEntity } from '../../entities/user.entity.ts'
import { CaptchaService } from '../../services/captcha.service.ts'

// Mirrors application/api/controller/Validate.php — 8 actions used by
// jQuery-Validation-style frontend form checks. Each returns the standard
// envelope (NOT the bare "true"/string format the original recon brief
// guessed); confirmed during baseline triage.
//
// `available` actions: code:1 means free; code:0 means already taken.
// `exist` actions: opposite.
// `check_*_correct` actions: code:1 if captcha matches a fresh fa_sms/fa_ems row.

const MOBILE_RE = /^1\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

@Controller('api/validate')
export class ApiValidateController {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly captcha: CaptchaService,
  ) {}

  // ---- *_available — code:1 if FREE (with optional id-exclusion) ---------

  @Post('check_email_available')
  async checkEmailAvailable(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const email = String(body['email'] ?? '').trim()
    const id = Number(body['id'] ?? 0)
    if (!email) return apiErr('Email is required')
    return (await this.availableOnUsers('email', email, id))
      ? apiOk('available') : apiErr('Email already exist')
  }

  @Post('check_username_available')
  async checkUsernameAvailable(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const username = String(body['username'] ?? '').trim()
    const id = Number(body['id'] ?? 0)
    if (!username) return apiErr('Username is required')
    return (await this.availableOnUsers('username', username, id))
      ? apiOk('available') : apiErr('Username already exist')
  }

  @Post('check_nickname_available')
  async checkNicknameAvailable(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const nickname = String(body['nickname'] ?? '').trim()
    const id = Number(body['id'] ?? 0)
    if (!nickname) return apiErr('Nickname is required')
    return (await this.availableOnUsers('nickname', nickname, id))
      ? apiOk('available') : apiErr('Nickname already exist')
  }

  @Post('check_mobile_available')
  async checkMobileAvailable(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const mobile = String(body['mobile'] ?? '').trim()
    const id = Number(body['id'] ?? 0)
    if (!mobile) return apiErr('Mobile is required')
    return (await this.availableOnUsers('mobile', mobile, id))
      ? apiOk('available') : apiErr('Mobile already exist')
  }

  // ---- *_exist — code:1 if PRESENT --------------------------------------

  @Post('check_mobile_exist')
  async checkMobileExist(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const mobile = String(body['mobile'] ?? '').trim()
    if (!MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    const exists = !!(await this.users.findOneBy({ mobile }))
    return exists ? apiOk('exists') : apiErr('Mobile not registered')
  }

  @Post('check_email_exist')
  async checkEmailExist(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const email = String(body['email'] ?? '').trim()
    if (!EMAIL_RE.test(email)) return apiErr('Email is incorrect')
    const exists = !!(await this.users.findOneBy({ email }))
    return exists ? apiOk('exists') : apiErr('Email not registered')
  }

  // ---- check_sms_correct / check_ems_correct ---------------------------

  @Post('check_sms_correct')
  async checkSmsCorrect(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const mobile = String(body['mobile'] ?? '').trim()
    const event = String(body['event'] ?? '').trim() || 'default'
    const captcha = String(body['captcha'] ?? '').trim()
    if (!mobile || !captcha) return apiErr('Invalid parameters')
    return (await this.captcha.checkSms(mobile, captcha, event))
      ? apiOk('ok') : apiErr('Captcha is incorrect')
  }

  @Post('check_ems_correct')
  async checkEmsCorrect(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const email = String(body['email'] ?? '').trim()
    const event = String(body['event'] ?? '').trim() || 'default'
    const captcha = String(body['captcha'] ?? '').trim()
    if (!email || !captcha) return apiErr('Invalid parameters')
    return (await this.captcha.checkEms(email, captcha, event))
      ? apiOk('ok') : apiErr('Captcha is incorrect')
  }

  // ---- internals --------------------------------------------------------

  private async availableOnUsers(
    field: 'email' | 'username' | 'nickname' | 'mobile',
    value: string,
    excludeId: number,
  ): Promise<boolean> {
    const where = excludeId > 0
      ? ({ [field]: value, id: Not(excludeId) } as Record<string, unknown>)
      : ({ [field]: value } as Record<string, unknown>)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.users as any).findOneBy(where)
    return !row
  }
}
