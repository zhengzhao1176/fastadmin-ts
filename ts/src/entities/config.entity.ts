// Maps `fa_config` — the admin/general/Config CRUD table.
// `setting` is JSON in MySQL; we keep it as string and decode in callers.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_config' })
export class ConfigEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 30, default: '' })
  name!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  group!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  title!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  tip!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  type!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  visible!: string

  @Column({ type: 'text', nullable: true })
  value!: string

  @Column({ type: 'text', nullable: true })
  content!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  rule!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  extend!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  setting!: string
}
