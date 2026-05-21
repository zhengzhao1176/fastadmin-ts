// Maps `fa_user_money_log` — the member balance-change ledger. One row is
// written by UserBalanceService.money() every time a user's `money` moves.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

// mysql2 hands `decimal` back as a string; transform to a number so the log
// rows read back as plain numbers like the rest of the codebase expects.
const decimal = { from: (v: string | null) => (v == null ? 0 : Number(v)), to: (v: number) => v }

@Entity({ name: 'fa_user_money_log' })
export class UserMoneyLogEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', unsigned: true, default: 0, comment: '会员ID' })
  user_id!: number

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: decimal, comment: '变更余额' })
  money!: number

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: decimal, comment: '变更前余额' })
  before!: number

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: decimal, comment: '变更后余额' })
  after!: number

  @Column({ type: 'varchar', length: 255, default: '', comment: '备注' })
  memo!: string

  @Column({
    type: 'bigint',
    nullable: true,
    comment: '创建时间',
    transformer: { from: (v: string | null) => (v == null ? null : Number(v)), to: (v: number | null) => v },
  })
  createtime!: number | null
}
