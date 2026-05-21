// Maps `fa_user_group` — frontend user role groups.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_user_group' })
export class UserGroupEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 50, default: '' })
  name!: string

  @Column({ type: 'text', nullable: true })
  rules!: string

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  updatetime!: number | null

  @Column({ type: 'enum', enum: ['normal', 'hidden'], nullable: true })
  status!: string | null
}
