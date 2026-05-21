import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { ApiAuthGuard } from '../../guards/api-auth.guard.ts'
import { AuthService } from '../../services/auth.service.ts'

interface TokenData {
  token: string
  expires_in: number
}

// Mirrors application/api/controller/Token.php. Both actions are guarded —
// PHP's Api::_initialize rejects requests with no/invalid token via the same
// 401 envelope our ApiAuthGuard produces.
@Controller('api/token')
export class ApiTokenController {
  constructor(private readonly auth: AuthService) {}

  @Get('check')
  @UseGuards(ApiAuthGuard)
  async check(@Req() req: Request & { rawToken?: string }): Promise<ApiEnvelope<TokenData | null>> {
    const tok = req.rawToken ?? ''
    const row = await this.auth.findTokenRow(tok)
    if (!row) return apiErr('请先登录', null, 401)
    return apiOk('Token is valid', {
      token: tok,
      expires_in: this.auth.remainingSeconds(row),
    })
  }

  @Post('refresh')
  @UseGuards(ApiAuthGuard)
  async refresh(@Req() req: Request & { rawToken?: string; user?: { id: number } }): Promise<ApiEnvelope<TokenData | null>> {
    const oldTok = req.rawToken ?? ''
    const userId = req.user?.id
    if (!userId) return apiErr('请先登录', null, 401)
    // Issue first so a successful refresh can never strand the user.
    const issued = await this.auth.issueToken(userId)
    if (oldTok) await this.auth.logout(oldTok)
    return apiOk('Token refreshed', { token: issued.token, expires_in: issued.expiresIn })
  }
}
