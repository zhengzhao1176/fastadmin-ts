// Maps `fa_admin_log` — the table admin/general/Profile lists for the
// logged-in admin and admin/auth/Adminlog manages.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_admin_log' })
export class AdminLogEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', unsigned: true, default: 0 })
  admin_id!: number

  @Column({ type: 'varchar', length: 30, default: '' })
  username!: string

  @Column({ type: 'varchar', length: 1500, default: '' })
  url!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  title!: string

  @Column({ type: 'longtext' })
  content!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  ip!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  useragent!: string

  @Column({ type: 'bigint', nullable: true, transformer: { from: (v: string | null) => v == null ? null : Number(v), to: (v: number | null) => v } })
  createtime!: number | null
}
