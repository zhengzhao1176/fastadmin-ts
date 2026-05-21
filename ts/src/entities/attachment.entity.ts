// Maps `fa_attachment`. We only model fields the upload flow writes; other
// columns (extparam, sha1, storage, etc.) get sensible defaults via the
// `default` declarations so INSERTs succeed without explicit values.
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'fa_attachment' })
export class AttachmentEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 50, default: '' })
  category!: string

  @Column({ type: 'varchar', length: 100, default: '' })
  filename!: string

  @Column({ type: 'int', default: 0 })
  imageheight!: number

  @Column({ type: 'varchar', length: 30, default: '' })
  imagetype!: string

  @Column({ type: 'varchar', length: 255 })
  url!: string

  @Column({ type: 'varchar', length: 50, default: '' })
  imagewidth!: string

  @Column({ type: 'int', default: 0 })
  imageframes!: number

  @Column({ type: 'int', default: 0 })
  filesize!: number

  @Column({ type: 'varchar', length: 100, default: '' })
  mimetype!: string

  @Column({ type: 'varchar', length: 255, default: '' })
  extparam!: string

  @Column({ type: 'int', default: 0 })
  createtime!: number

  @Column({ type: 'int', default: 0 })
  updatetime!: number

  @Column({ type: 'int', default: 0 })
  uploadtime!: number

  @Column({ type: 'varchar', length: 100, default: 'local' })
  storage!: string

  @Column({ type: 'varchar', length: 30, default: '' })
  sha1!: string

  @Column({ type: 'int', default: 0 })
  admin_id!: number

  @Column({ type: 'int', default: 0 })
  user_id!: number
}
