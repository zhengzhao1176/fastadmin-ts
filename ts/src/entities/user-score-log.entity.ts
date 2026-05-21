// Maps `fa_user_score_log` — the member point-change ledger. One row is
// written by UserBalanceService.score() every time a user's `score` moves.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_user_score_log' })
export class UserScoreLogEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', unsigned: true, default: 0, comment: '会员ID' })
  user_id!: number

  @Column({ type: 'int', default: 0, comment: '变更积分' })
  score!: number

  @Column({ type: 'int', default: 0, comment: '变更前积分' })
  before!: number

  @Column({ type: 'int', default: 0, comment: '变更后积分' })
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
