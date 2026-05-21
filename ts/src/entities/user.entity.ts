// Maps `fa_user`. We don't define every column — only fields auth + profile
// flows need. Adding new fields as more controllers get ported.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_user' })
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', name: 'group_id', default: 1 })
  group_id!: number

  @Column({ type: 'varchar', length: 32, default: '' })
  username!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  nickname!: string

  @Column({ type: 'varchar', length: 32, default: '' })
  password!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  salt!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  email!: string

  @Column({ type: 'varchar', length: 11, default: '' })
  mobile!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  avatar!: string

  @Column({ type: 'int', default: 0 })
  score!: number

  // `decimal` arrives as a string from mysql2 — transform to a number so
  // arithmetic in UserBalanceService.money() works without surprises.
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: { from: (v: string | null) => (v == null ? 0 : Number(v)), to: (v: number) => v },
  })
  money!: number

  @Column({ type: 'varchar', length: 30, default: 'normal' })
  status!: string

  @Column({ type: 'bigint', default: 0, transformer: { from: (v: string) => Number(v), to: (v: number) => v } })
  createtime!: number

  @Column({ type: 'bigint', default: 0, transformer: { from: (v: string) => Number(v), to: (v: number) => v } })
  updatetime!: number
}
