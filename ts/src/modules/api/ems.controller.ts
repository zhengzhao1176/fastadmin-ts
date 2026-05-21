import { Body, Controller, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { CaptchaService } from '../../services/captcha.service.ts'
import { MailerService } from '../../services/mailer.service.ts'

// Mirrors application/api/controller/Ems.php. PHP's ems_send hook calls the
// Email library which talks SMTP to mailhog. TS does the same via nodemailer.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_EVENTS = new Set(['register', 'changeemail', 'changepwd', 'resetpwd', 'default'])

@Controller('api/ems')
export class ApiEmsController {
  constructor(
    private readonly captcha: CaptchaService,
    private readonly mailer: MailerService,
  ) {}

  @Post('send')
  async send(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<ApiEnvelope<null>> {
    const email = String(body['email'] ?? '').trim()
    const event = String(body['event'] ?? '').trim() || 'default'
    if (!EMAIL_RE.test(email)) return apiErr('Email is incorrect')
    if (!ALLOWED_EVENTS.has(event)) return apiErr('Event is incorrect')
    const r = await this.captcha.sendEms(email, event, req.ip ?? '127.0.0.1')
    if (!r.ok) {
      return apiErr(r.error === 'cooldown' ? '发送频繁' : '发送失败')
    }
    // Best-effort delivery via mailhog. PHP behaviour: if hook returns false,
    // the row is rolled back; we mirror by flushing on send failure.
    const delivered = await this.mailer.send({
      to: email,
      subject: `Verification code: ${r.code}`,
      text: `Your verification code is: ${r.code} (event=${event})`,
    })
    if (!delivered) {
      await this.captcha.flushEms(email, event)
      return apiErr('发送失败')
    }
    return apiOk('发送成功', null)
  }

  @Post('check')
  async check(@Body() body: Record<string, unknown>): Promise<ApiEnvelope<null>> {
    const email = String(body['email'] ?? '').trim()
    const event = String(body['event'] ?? '').trim() || 'default'
    const captcha = String(body['captcha'] ?? '').trim()
    if (!EMAIL_RE.test(email)) return apiErr('Email is incorrect')
    if (!captcha) return apiErr('Captcha is incorrect')
    return (await this.captcha.checkEms(email, captcha, event))
      ? apiOk('Captcha is correct', null)
      : apiErr('Captcha is incorrect')
  }
}
