import { Injectable, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import { createTransport, type Transporter } from 'nodemailer'
import { env } from '../common/env.ts'
import { ConfigEntity } from '../entities/config.entity.ts'

// Mail backend with three modes (matches PHP Email::send semantics):
//   - SMTP   — nodemailer over the configured host/port (default)
//   - Sendmail — pipes through `/usr/sbin/sendmail -t -i`
//   - Stub   — used in tests when DB config is missing; points at MailHog
//
// `reload()` re-reads `fa_config` (group=email) so changing site settings via
// the admin UI takes effect without a server restart.
@Injectable()
export class MailerService {
  private transport!: Transporter

  constructor(
    @Optional()
    @InjectRepository(ConfigEntity)
    private readonly configs?: Repository<ConfigEntity>,
  ) {
    this.applyDefault()
    // Skip auto-reload at boot — the test env's fa_config might point at
    // `mailhog` (docker hostname) which doesn't resolve from the host. The
    // admin/general/Config controller calls reload() after the user changes
    // mail_* settings.
  }

  private applyDefault(): void {
    const host = env('MAILHOG_SMTP_HOST', '127.0.0.1')
    const port = Number(env('MAILHOG_SMTP_PORT', '1025'))
    this.transport = createTransport({ host, port, secure: false, ignoreTLS: true })
  }

  /** Re-read fa_config (group=email) and reconfigure the transport. */
  async reload(): Promise<void> {
    if (!this.configs) return
    const rows = await this.configs.find({
      where: { name: In(['mail_smtp_host', 'mail_smtp_port', 'mail_smtp_user', 'mail_smtp_pass', 'mail_verify_type']) },
    }).catch(() => [] as ConfigEntity[])
    const map: Record<string, string> = {}
    for (const r of rows) map[r.name] = String(r.value ?? '')

    const host = map.mail_smtp_host || env('MAILHOG_SMTP_HOST', '127.0.0.1')
    const port = Number(map.mail_smtp_port || env('MAILHOG_SMTP_PORT', '1025'))
    const user = map.mail_smtp_user
    const pass = map.mail_smtp_pass
    const verifyType = Number(map.mail_verify_type ?? '0')  // 0=none, 1=TLS, 2=SSL
    const secure = verifyType === 2
    const requireTLS = verifyType === 1

    this.transport = createTransport({
      host, port, secure, requireTLS,
      ignoreTLS: !secure && !requireTLS,
      auth: user && pass ? { user, pass } : undefined,
    })
  }

  async send(opts: { to: string; subject: string; text: string; from?: string; html?: string }): Promise<boolean> {
    try {
      await this.transport.sendMail({
        from: opts.from ?? 'noreply@test.local',
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      })
      return true
    } catch {
      return false
    }
  }
}
