// Maps `fa_category`. Schema mirrors install.sql.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_category' })
export class CategoryEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', unsigned: true, default: 0 })
  pid!: number

  @Column({ type: 'varchar', length: 30, default: '' })
  type!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  name!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  nickname!: string

  // MySQL stores this as `set('hot','index','recommend')` but mysql2 returns it
  // as a comma-joined string; we let it flow through as varchar.
  @Column({ type: 'varchar', default: '' })
  flag!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  image!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  keywords!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  description!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  diyname!: string

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  updatetime!: number | null

  @Column({ type: 'int', default: 0 })
  weigh!: number

  @Column({ type: 'varchar', length: 30, default: '' })
  status!: string
}
