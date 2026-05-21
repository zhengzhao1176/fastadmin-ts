// Maps `fa_area` — the PRC province/city/county hierarchy.
// Populated by the install SQL (or `npm run think install`). The
// `/admin/ajax/area` endpoint reads from here for the cascading
// province → city → county dropdown widget.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_area' })
export class AreaEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int', nullable: true })
  pid!: number | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  shortname!: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  name!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  mergename!: string | null

  @Column({ type: 'tinyint', nullable: true })
  level!: number | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  pinyin!: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  code!: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  zip!: string | null

  @Column({ type: 'varchar', length: 50, nullable: true })
  first!: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  lng!: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  lat!: string | null
}
