// Maps `fa_ems`. Same shape as fa_sms with `email` in place of `mobile`.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_ems' })
export class EmsEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 30 })
  event!: string

  @Column({ type: 'varchar', length: 100 })
  email!: string

  @Column({ type: 'varchar', length: 10 })
  code!: string

  @Column({ type: 'int', default: 0 })
  times!: number

  @Column({ type: 'varchar', length: 30, nullable: true })
  ip!: string

  @Column({ type: 'bigint', default: 0, transformer: { from: (v: string) => Number(v), to: (v: number) => v } })
  createtime!: number
}
