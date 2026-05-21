// Frontend (index module) auth guard. Validates the `token` cookie against
// fa_user_token + fa_user. Mirrors application/common/controller/Frontend.php's
// auth gate. Ajax → JSON envelope code 0; non-ajax → 302 to /index/user/login.
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { apiErr } from '../common/envelope.ts'
import { AuthService } from '../services/auth.service.ts'

interface FrontendReq extends Request {
  user?: { id: number; username: string }
  session?: { __token__?: string } & Record<string, unknown>
}

@Injectable()
export class FrontendAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FrontendReq>()
    const token = String(req.cookies?.['token'] ?? '')
      || String(req.headers['token'] ?? '') // also accept api-style header
    const user = token ? await this.auth.getUserByToken(token) : null
    if (!user) {
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest'
      if (isAjax) throw new HttpException(apiErr('请登录'), HttpStatus.OK)
      const res = ctx.switchToHttp().getResponse<Response>()
      res.redirect(302, '/index/user/login')
      return false
    }
    req.user = { id: user.id, username: user.username }
    return true
  }
}
