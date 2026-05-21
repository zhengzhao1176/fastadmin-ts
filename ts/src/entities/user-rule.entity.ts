// Maps `fa_user_rule` — frontend permission tree.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_user_rule' })
export class UserRuleEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', nullable: true, default: 0 })
  pid!: number | null

  @Column({ type: 'varchar', length: 50, nullable: true, default: '' })
  name!: string | null

  @Column({ type: 'varchar', length: 50, default: '' })
  title!: string

  @Column({ type: 'varchar', length: 100, nullable: true })
  remark!: string | null

  @Column({ type: 'tinyint', nullable: true })
  ismenu!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  updatetime!: number | null

  @Column({ type: 'int', default: 0 })
  weigh!: number

  @Column({ type: 'enum', enum: ['normal', 'hidden'], nullable: true })
  status!: string | null
}
