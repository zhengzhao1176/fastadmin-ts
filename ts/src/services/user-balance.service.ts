// Ports FastAdmin's `\app\common\model\User::money()` / `::score()` — the
// canonical way a member's balance or points are adjusted. Each call updates
// `fa_user` AND appends a row to the matching ledger table so every change is
// auditable. Addons (recharge, sign-in, orders, …) call these instead of
// touching `fa_user.money` / `fa_user.score` directly.
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { UserEntity } from '../entities/user.entity.ts'
import { UserMoneyLogEntity } from '../entities/user-money-log.entity.ts'
import { UserScoreLogEntity } from '../entities/user-score-log.entity.ts'

export interface BalanceChange {
  ok: boolean
  /** balance/points before the change */
  before?: number
  /** balance/points after the change */
  after?: number
  error?: string
}

@Injectable()
export class UserBalanceService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(UserMoneyLogEntity) private readonly moneyLogs: Repository<UserMoneyLogEntity>,
    @InjectRepository(UserScoreLogEntity) private readonly scoreLogs: Repository<UserScoreLogEntity>,
  ) {}

  /**
   * Adjust user `userId`'s balance by `amount` (may be negative) and write a
   * `fa_user_money_log` row. Mirrors PHP `User::money()` — a zero `amount` is
   * a documented no-op (no row written). Amounts are rounded to 2 decimals.
   */
  async money(amount: number, userId: number, memo = ''): Promise<BalanceChange> {
    if (!Number.isFinite(amount)) return { ok: false, error: 'Invalid amount' }
    const user = await this.users.findOneBy({ id: userId })
    if (!user) return { ok: false, error: 'No Results were found' }
    const before = round2(Number(user.money ?? 0))
    if (amount === 0) return { ok: true, before, after: before }
    const after = round2(before + amount)
    user.money = after
    await this.users.save(user)
    await this.moneyLogs.save(this.moneyLogs.create({
      user_id: userId,
      money: round2(amount),
      before,
      after,
      memo,
      createtime: Math.floor(Date.now() / 1000),
    }))
    return { ok: true, before, after }
  }

  /**
   * Adjust user `userId`'s points by `amount` (may be negative) and write a
   * `fa_user_score_log` row. Mirrors PHP `User::score()`. Points are integers.
   */
  async score(amount: number, userId: number, memo = ''): Promise<BalanceChange> {
    if (!Number.isFinite(amount)) return { ok: false, error: 'Invalid amount' }
    const delta = Math.trunc(amount)
    const user = await this.users.findOneBy({ id: userId })
    if (!user) return { ok: false, error: 'No Results were found' }
    const before = Math.trunc(Number(user.score ?? 0))
    if (delta === 0) return { ok: true, before, after: before }
    const after = before + delta
    user.score = after
    await this.users.save(user)
    await this.scoreLogs.save(this.scoreLogs.create({
      user_id: userId,
      score: delta,
      before,
      after,
      memo,
      createtime: Math.floor(Date.now() / 1000),
    }))
    return { ok: true, before, after }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
