// Auto-log successful admin POST actions into fa_admin_log. Mirrors PHP's
// admin behaviour (app\admin\library\Auth or common\behavior) which fires
// AdminLog::record() after each non-read admin write.
//
// Heuristics (kept tight to match what tests assert):
//   - request must be POST
//   - URL must start with /admin.php/
//   - URL must NOT match the read-only paths (index, login, logout,
//     selectpage, roletree, add[GET], edit[GET], detail, *) or be the
//     adminlog controller itself
//   - response must be an admin envelope with code === 1
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import type { Request } from 'express'
import { AdminLogEntity } from '../entities/admin-log.entity.ts'

interface ReqWithAdminSession extends Request {
  session: { admin?: { id: number; username: string } } & Record<string, unknown>
}

const READ_ACTIONS = /\/(index|login|logout|selectpage|roletree|rulelist|check|get_table_list|get_fields_list)(\?|$|\/)/

@Injectable()
export class AdminLogInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(AdminLogEntity) private readonly logs: Repository<AdminLogEntity>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap((response: unknown) => {
        const req = ctx.switchToHttp().getRequest<ReqWithAdminSession>()
        if (req.method !== 'POST') return
        const url = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? ''
        if (!url.startsWith('/admin.php/')) return
        if (READ_ACTIONS.test(url)) return
        if (url.includes('/auth/adminlog/')) return
        if (url.includes('/general/profile/index')) return
        if (!response || typeof response !== 'object') return
        const env = response as { code?: number }
        if (env.code !== 1) return
        const sess = req.session?.admin
        // Fire-and-forget; failure to log must not break the response.
        void this.logs.save(this.logs.create({
          admin_id: sess?.id ?? 0,
          username: sess?.username ?? '',
          url,
          title: '',
          content: '',
          ip: req.ip ?? '',
          useragent: String(req.headers['user-agent'] ?? ''),
          createtime: Math.floor(Date.now() / 1000),
        })).catch(() => { /* ignore */ })
      }),
    )
  }
}
