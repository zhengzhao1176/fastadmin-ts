// Maps `fa_auth_rule` — menu/permission tree.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_auth_rule' })
export class AuthRuleEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'enum', enum: ['menu', 'file'], default: 'file' })
  type!: string

  @Column({ type: 'int', unsigned: true, default: 0 })
  pid!: number

  @Column({ type: 'varchar', length: 100, default: '' })
  name!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  title!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  icon!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  url!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  condition!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  remark!: string

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  ismenu!: number

  @Column({ type: 'enum', enum: ['addtabs', 'blank', 'dialog', 'ajax'], nullable: true })
  menutype!: string | null

  @Column({ type: 'varchar', length: 255, default: '' })
  extend!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  py!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  pinyin!: string

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  updatetime!: number | null

  @Column({ type: 'int', default: 0 })
  weigh!: number

  @Column({ type: 'varchar', length: 30, default: '' })
  status!: string
}
