import { All, Controller } from '@nestjs/common'
import { apiOk, type ApiEnvelope } from '../../common/envelope.ts'

// Mirrors application/api/controller/Index.php — one action that returns
// `{code:1, msg:'请求成功', time, data:null}` per the spec.
@Controller('api/index')
export class ApiIndexController {
  // PHP doesn't restrict method, accept any (GET/POST/etc.).
  @All('index')
  index(): ApiEnvelope<null> {
    return apiOk('请求成功')
  }
}
