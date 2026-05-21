import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from '../services/auth.service.ts'
import { apiErr } from '../common/envelope.ts'

// Replaces PHP's Api::_initialize() auth check. Reads `token` from header
// (preferred) or `token` form/query field, looks it up via AuthService, and
// attaches the user to req. Missing/invalid → 401 with apiErr envelope.
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown; rawToken?: string }>()
    const token =
      String(req.headers['token'] ?? '') ||
      String((req.query as Record<string, string>)['token'] ?? '') ||
      String((req.body as Record<string, string>)?.['token'] ?? '')
    const user = await this.auth.getUserByToken(token)
    if (!user) {
      // PHP responds with code=401 in body AND HTTP 401 status.
      throw new HttpException(apiErr('请先登录', null, 401), HttpStatus.UNAUTHORIZED)
    }
    req.user = user
    req.rawToken = token
    return true
  }
}
