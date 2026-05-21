// Maps `fa_user_token`. PHP's Mysql token driver hashes the raw token via
// `hash_hmac` before storing — to keep TS interop simple and self-contained,
// we store the raw UUID token here. PHP-issued tokens won't be readable by TS
// (and vice versa) but that's fine: each test run authenticates against one
// server, and our auth is internally consistent.
import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'fa_user_token' })
export class UserTokenEntity {
  @PrimaryColumn({ type: 'varchar', length: 88 })
  token!: string

  @Column({ type: 'int' })
  user_id!: number

  @Column({ type: 'int', default: 0 })
  createtime!: number

  @Column({ type: 'int', default: 0 })
  expiretime!: number
}
