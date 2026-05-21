import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Not, Repository } from 'typeorm'
import { UserEntity } from '../entities/user.entity.ts'
import { UserTokenEntity } from '../entities/user-token.entity.ts'
import { fastadminHash, randomSalt, randomToken } from '../common/hash.ts'

export interface LoginResult {
  ok: boolean
  user?: UserEntity
  token?: string
  expires_in?: number
  error?: 'account_not_found' | 'account_locked' | 'password_incorrect'
}

export interface RegisterInput {
  username: string
  password: string
  email?: string
  mobile?: string
}

export type RegisterError =
  | 'invalid_params'
  | 'username_exists'
  | 'nickname_exists'
  | 'email_exists'
  | 'mobile_exists'

export interface RegisterResult {
  ok: boolean
  user?: UserEntity
  token?: string
  expires_in?: number
  error?: RegisterError
}

const TOKEN_TTL = 30 * 24 * 60 * 60 // 30 days

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(UserTokenEntity) private readonly tokens: Repository<UserTokenEntity>,
  ) {}

  async login(account: string, password: string): Promise<LoginResult> {
    const user = await this.findByAccount(account)
    if (!user) return { ok: false, error: 'account_not_found' }
    if (user.status !== 'normal') return { ok: false, error: 'account_locked' }
    if (fastadminHash(password, user.salt) !== user.password) {
      return { ok: false, error: 'password_incorrect' }
    }
    const issued = await this.issueToken(user.id)
    return { ok: true, user, token: issued.token, expires_in: issued.expiresIn }
  }

  /**
   * Account-by-format resolver. Same heuristic as PHP Auth::login:
   *   '@' in string → email; matches /^1\d{10}$/ → mobile; else username.
   */
  async findByAccount(account: string): Promise<UserEntity | null> {
    if (account.includes('@')) return this.users.findOneBy({ email: account })
    if (/^1\d{10}$/.test(account)) return this.users.findOneBy({ mobile: account })
    return this.users.findOneBy({ username: account })
  }

  async findByMobile(mobile: string): Promise<UserEntity | null> {
    return this.users.findOneBy({ mobile })
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.users.findOneBy({ email })
  }

  async findById(id: number): Promise<UserEntity | null> {
    return this.users.findOneBy({ id })
  }

  /**
   * register flow — mirrors PHP Auth::register. Pre-checks uniqueness across
   * username/nickname/email/mobile then INSERTs and issues a token.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    const { username, password } = input
    const email = (input.email ?? '').trim()
    const mobile = (input.mobile ?? '').trim()
    if (!username || !password) return { ok: false, error: 'invalid_params' }

    if (await this.users.findOneBy({ username })) return { ok: false, error: 'username_exists' }
    if (await this.users.findOneBy({ nickname: username })) return { ok: false, error: 'nickname_exists' }
    if (email && await this.users.findOneBy({ email })) return { ok: false, error: 'email_exists' }
    if (mobile && await this.users.findOneBy({ mobile })) return { ok: false, error: 'mobile_exists' }

    const now = Math.floor(Date.now() / 1000)
    const salt = randomSalt(4)
    // username masking when username == mobile mirrors Auth::register.
    const nickname = /^1\d{10}$/.test(username)
      ? username.slice(0, 3) + '****' + username.slice(7)
      : username
    const inserted = await this.users.save(this.users.create({
      group_id: 1,
      username,
      nickname,
      password: fastadminHash(password, salt),
      salt,
      email,
      mobile,
      status: 'normal',
      createtime: now,
      updatetime: now,
    }))
    const issued = await this.issueToken(inserted.id)
    return { ok: true, user: inserted, token: issued.token, expires_in: issued.expiresIn }
  }

  /** Issue a fresh token row and return it. */
  async issueToken(userId: number): Promise<{ token: string; expiresIn: number }> {
    const tok = randomToken()
    const now = Math.floor(Date.now() / 1000)
    await this.tokens.insert({
      token: tok,
      user_id: userId,
      createtime: now,
      expiretime: now + TOKEN_TTL,
    })
    return { token: tok, expiresIn: TOKEN_TTL }
  }

  /** Look up the token row by raw token. Returns null if not found. */
  async findTokenRow(rawToken: string): Promise<UserTokenEntity | null> {
    if (!rawToken) return null
    return this.tokens.findOneBy({ token: rawToken })
  }

  /** Compute remaining seconds for a token row; 0 if expired or already-zero TTL. */
  remainingSeconds(row: UserTokenEntity): number {
    if (row.expiretime <= 0) return 0
    return Math.max(0, row.expiretime - Math.floor(Date.now() / 1000))
  }

  async getUserByToken(rawToken: string): Promise<UserEntity | null> {
    if (!rawToken) return null
    const row = await this.tokens.findOneBy({ token: rawToken })
    if (!row) return null
    const now = Math.floor(Date.now() / 1000)
    if (row.expiretime > 0 && row.expiretime < now) return null
    return await this.users.findOneBy({ id: row.user_id })
  }

  async logout(rawToken: string): Promise<void> {
    if (!rawToken) return
    await this.tokens.delete({ token: rawToken })
  }

  /** Update arbitrary user fields (use sparingly). */
  async updateUser(id: number, patch: Partial<UserEntity>): Promise<void> {
    await this.users.update({ id }, { ...patch, updatetime: Math.floor(Date.now() / 1000) })
  }

  /** Reset password — generates a new salt and stores md5(md5(pw)+salt). */
  async resetPassword(userId: number, newPassword: string): Promise<void> {
    const salt = randomSalt(4)
    await this.users.update({ id: userId }, {
      salt,
      password: fastadminHash(newPassword, salt),
      updatetime: Math.floor(Date.now() / 1000),
    })
  }

  /** Returns true if another user already uses this nickname (excludes selfId). */
  async nicknameTaken(nickname: string, selfId: number): Promise<boolean> {
    const row = await this.users.findOneBy({ nickname, id: Not(selfId) })
    return !!row
  }

  async usernameTaken(username: string, selfId: number): Promise<boolean> {
    const row = await this.users.findOneBy({ username, id: Not(selfId) })
    return !!row
  }

  async emailTaken(email: string, selfId: number): Promise<boolean> {
    const row = await this.users.findOneBy({ email, id: Not(selfId) })
    return !!row
  }

  async mobileTaken(mobile: string, selfId: number): Promise<boolean> {
    const row = await this.users.findOneBy({ mobile, id: Not(selfId) })
    return !!row
  }
}
