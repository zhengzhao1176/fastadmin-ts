import { Body, Controller, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { CaptchaService } from '../../services/captcha.service.ts'

// Mirrors application/api/controller/Sms.php — two open endpoints.
//   send  — validates mobile regex, writes fa_sms row, returns ok
//   check — validates captcha against fa_sms row
const MOBILE_RE = /^1\d{10}$/
const ALLOWED_EVENTS = new Set(['register', 'mobilelogin', 'changemobile', 'changepwd', 'resetpwd', 'default'])

@Controller('api/sms')
export class ApiSmsController {
  constructor(private readonly captcha: CaptchaService) {}

  @Post('send')
  async send(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<ApiEnvelope<null>> {
    const mobile = String(body['mobile'] ?? '').trim()
    const event = String(body['event'] ?? '').trim() || 'default'
    if (!MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    if (!ALLOWED_EVENTS.has(event)) return apiErr('Event is incorrect')
    const r = await this.captcha.sendSms(mobile, event, req.ip ?? '127.0.0.1')
    if (!r.ok) {
      return apiErr(r.error === 'cooldown' ? '发送频繁' : '发送失败')
    }
    return apiOk('发送成功', null)
  }

  @Post('check')
  async check(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const mobile = String(body['mobile'] ?? '').trim()
    const event = String(body['event'] ?? '').trim() || 'default'
    const captcha = String(body['captcha'] ?? '').trim()
    if (!MOBILE_RE.test(mobile)) return apiErr('Mobile is incorrect')
    if (!captcha) return apiErr('Captcha is incorrect')
    return (await this.captcha.checkSms(mobile, captcha, event))
      ? apiOk('Captcha is correct', null)
      : apiErr('Captcha is incorrect')
  }
}
