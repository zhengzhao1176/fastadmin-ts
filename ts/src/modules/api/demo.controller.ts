import { All, Body, Controller, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { ApiAuthGuard } from '../../guards/api-auth.guard.ts'
import type { UserEntity } from '../../entities/user.entity.ts'

// Mirrors application/api/controller/Demo.php — example endpoints that echo
// request params. PHP: noNeedLogin = ['test', 'test1'], noNeedRight = ['test2'].
// → test/test1: open. test2: needs login (but skips perm node check). test3:
// needs login and (in PHP) perm node — we enforce login only here.
@Controller('api/demo')
export class ApiDemoController {
  // test — echoes request params (PHP: $this->success('返回成功', $this->request->param()))
  @All('test')
  test(
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
  ): ApiEnvelope<Record<string, string>> {
    return apiOk('返回成功', stringify({ ...query, ...body }))
  }

  // test1 — fixed payload (PHP returns {action: 'test1'})
  @All('test1')
  test1(): ApiEnvelope<{ action: string }> {
    return apiOk('返回成功', { action: 'test1' })
  }

  // test2 — requires login (noNeedRight allows skipping permission node check)
  @All('test2')
  @UseGuards(ApiAuthGuard)
  test2(): ApiEnvelope<{ action: string }> {
    return apiOk('返回成功', { action: 'test2' })
  }

  // test3 — requires login + (in PHP) permission node. We enforce login only.
  @All('test3')
  @UseGuards(ApiAuthGuard)
  test3(): ApiEnvelope<{ action: string }> {
    return apiOk('返回成功', { action: 'test3' })
  }
}

function stringify(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    out[k] = v == null ? '' : String(v)
  }
  return out
}
