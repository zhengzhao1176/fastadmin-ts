// Maps `fa_auth_group` — admin role groups.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_auth_group' })
export class AuthGroupEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', unsigned: true, default: 0 })
  pid!: number

  @Column({ type: 'varchar', length: 100, default: '' })
  name!: string

  @Column({ type: 'text' })
  rules!: string

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  updatetime!: number | null

  @Column({ type: 'varchar', length: 30, default: '' })
  status!: string
}
