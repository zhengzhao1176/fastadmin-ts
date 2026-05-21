import { Controller, Get, HttpCode } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(200)
  check(): { status: string; uptime: number; ts: number } {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      ts: Math.floor(Date.now() / 1000),
    }
  }
}
