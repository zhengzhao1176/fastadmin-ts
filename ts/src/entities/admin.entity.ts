// Maps `fa_admin`. PHP stores password as md5(md5(pw)+salt), salt is a random
// 4-char alnum string. We reuse the same algorithm via common/hash.ts.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_admin' })
export class AdminEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 20, default: '' })
  username!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  nickname!: string

  @Column({ type: 'varchar', length: 32, default: '' })
  password!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  salt!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  avatar!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  email!: string

  @Column({ type: 'varchar', length: 11, default: '' })
  mobile!: string

  @Column({ type: 'tinyint', default: 0 })
  loginfailure!: number

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  logintime!: number | null

  @Column({ type: 'varchar', length: 50, nullable: true })
  loginip!: string | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  updatetime!: number | null

  @Column({ type: 'varchar', length: 59, default: '' })
  token!: string

  @Column({ type: 'varchar', length: 30, default: 'normal' })
  status!: string
}
