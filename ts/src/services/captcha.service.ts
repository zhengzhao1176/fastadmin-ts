import { Injectable, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { SmsEntity } from '../entities/sms.entity.ts'
import { EmsEntity } from '../entities/ems.entity.ts'
import { SmsService } from './sms.service.ts'

// Mirrors PHP's Sms::check / Sms::send / Ems::check / Ems::send from
// fastAdmin/application/common/library/{Sms,Ems}.php. Constants match PHP
// defaults: $expire=120s, $maxCheckNums=10, 60s send cooldown per key+event.
const EXPIRE_SEC = 120
const MAX_CHECK_NUMS = 10
const SEND_COOLDOWN_SEC = 60

function randomCode(): string {
  // PHP default is 4 digits via mt_rand(1000, 9999).
  return String(1000 + Math.floor(Math.random() * 9000))
}

export interface SendResult {
  ok: boolean
  code?: string
  error?: 'cooldown' | 'storage_failed'
}

@Injectable()
export class CaptchaService {
  constructor(
    @InjectRepository(SmsEntity) private readonly smsRepo: Repository<SmsEntity>,
    @InjectRepository(EmsEntity) private readonly emsRepo: Repository<EmsEntity>,
    @Optional() private readonly sms?: SmsService,
  ) {}

  // ---- check ------------------------------------------------------------

  async checkSms(mobile: string, code: string, event: string): Promise<boolean> {
    return this.check(this.smsRepo, { mobile, event }, code)
  }

  async checkEms(email: string, code: string, event: string): Promise<boolean> {
    return this.check(this.emsRepo, { email, event }, code)
  }

  // ---- flush ------------------------------------------------------------

  async flushSms(mobile: string, event: string): Promise<void> {
    await this.smsRepo.delete({ mobile, event })
  }

  async flushEms(email: string, event: string): Promise<void> {
    await this.emsRepo.delete({ email, event })
  }

  // ---- send -------------------------------------------------------------

  async sendSms(mobile: string, event: string, ip: string): Promise<SendResult> {
    const result = await this.send(this.smsRepo, { mobile, event }, { mobile, event, ip })
    if (result.ok && result.code && this.sms) {
      // Hand off to the registered SMS adapter (default = MockSmsAdapter).
      // Failure here doesn't roll back — the row still exists, the test stub
      // doesn't actually care, and the consumer can retry.
      await this.sms.send(mobile, result.code, event).catch(() => false)
    }
    return result
  }

  async sendEms(email: string, event: string, ip: string): Promise<SendResult> {
    return this.send(this.emsRepo, { email, event }, { email, event, ip })
  }

  // ---- internals --------------------------------------------------------

  private async check<T extends { id: number; code: string; times: number; createtime: number }>(
    repo: Repository<T>,
    where: Record<string, unknown>,
    submittedCode: string,
  ): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (repo as any).findOne({ where, order: { id: 'DESC' } }) as T | null
    if (!row) return false
    const cutoff = Math.floor(Date.now() / 1000) - EXPIRE_SEC
    if (row.createtime <= cutoff || row.times > MAX_CHECK_NUMS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (repo as any).delete(where)
      return false
    }
    if (row.code !== submittedCode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (repo as any).increment(where, 'times', 1)
      return false
    }
    return true
  }

  private async send<T extends { id: number; code: string; createtime: number }>(
    repo: Repository<T>,
    cooldownWhere: Record<string, unknown>,
    insertRow: Record<string, unknown>,
  ): Promise<SendResult> {
    const now = Math.floor(Date.now() / 1000)
    // Cooldown: if any row exists for this key+event in the last 60s, reject.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latest = await (repo as any).findOne({
      where: cooldownWhere,
      order: { id: 'DESC' },
    }) as T | null
    if (latest && latest.createtime >= now - SEND_COOLDOWN_SEC) {
      return { ok: false, error: 'cooldown' }
    }
    const code = randomCode()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (repo as any).insert({ ...insertRow, code, times: 0, createtime: now })
    } catch {
      return { ok: false, error: 'storage_failed' }
    }
    return { ok: true, code }
  }
}
