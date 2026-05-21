// Maps `fa_sms`. Sms::check expects `times`, `ip`, `createtime` (no updatetime).
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_sms' })
export class SmsEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 30 })
  event!: string

  @Column({ type: 'varchar', length: 20 })
  mobile!: string

  @Column({ type: 'varchar', length: 10 })
  code!: string

  @Column({ type: 'int', default: 0 })
  times!: number

  @Column({ type: 'varchar', length: 30, nullable: true })
  ip!: string

  @Column({ type: 'bigint', default: 0, transformer: { from: (v: string) => Number(v), to: (v: number) => v } })
  createtime!: number
}
