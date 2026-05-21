import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AdminEntity } from '../entities/admin.entity.ts'
import { fastadminHash } from '../common/hash.ts'

export type AdminLoginError =
  | 'invalid_params'
  | 'username_incorrect'
  | 'admin_forbidden'
  | 'password_incorrect'

export interface AdminLoginResult {
  ok: boolean
  admin?: AdminEntity
  error?: AdminLoginError
}

// Mirrors application/admin/library/Auth.php — the admin login flow:
//   1. lookup by username
//   2. status must be normal
//   3. check md5(md5(pw)+salt) against stored password
//   4. on success: bump logintime/loginip, clear loginfailure
// The session is managed at the controller level (express-session in NestJS).
@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminEntity) private readonly admins: Repository<AdminEntity>,
  ) {}

  async login(username: string, password: string, ip = '127.0.0.1'): Promise<AdminLoginResult> {
    if (!username || !password) return { ok: false, error: 'invalid_params' }
    const admin = await this.admins.findOneBy({ username })
    if (!admin) return { ok: false, error: 'username_incorrect' }
    if (admin.status !== 'normal') return { ok: false, error: 'admin_forbidden' }
    if (admin.password !== fastadminHash(password, admin.salt)) {
      // PHP bumps loginfailure on bad password; we follow.
      await this.admins.increment({ id: admin.id }, 'loginfailure', 1)
      return { ok: false, error: 'password_incorrect' }
    }
    const now = Math.floor(Date.now() / 1000)
    await this.admins.update({ id: admin.id }, {
      loginfailure: 0,
      logintime: now,
      loginip: ip,
      updatetime: now,
    })
    return { ok: true, admin }
  }

  async findById(id: number): Promise<AdminEntity | null> {
    return this.admins.findOneBy({ id })
  }
}
