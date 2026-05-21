// Maps `fa_auth_group_access` — the (uid, group_id) join table. The MySQL
// table has UNIQUE KEY (uid, group_id) but no explicit PK; we mark both as
// primary so TypeORM has something to bind upserts/deletes to.
import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'fa_auth_group_access' })
export class AuthGroupAccessEntity {
  @PrimaryColumn({ type: 'int', unsigned: true })
  uid!: number

  @PrimaryColumn({ type: 'int', unsigned: true })
  group_id!: number
}
