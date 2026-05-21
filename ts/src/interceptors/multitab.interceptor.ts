// `ref=addtabs` multi-tab redirect. Mirrors PHP Backend::_initialize's
// addtabs handling: when an admin clicks a sidebar link via the AdminLTE
// multi-tab UI, the browser sends `?ref=addtabs` so the backend should
// redirect to the home (index/index) with the original URL preserved as
// the `referer` query param. The frontend JS then opens that URL in a new
// tab pane.
//
// Behaviour gates:
//   - GET only (POST/PUT etc. ignored)
//   - non-ajax only (XMLHttpRequest header absent)
//   - non-dialog (no `dialog=1`) and non-addtabs (no `addtabs=1`)
//   - `ref=addtabs` present in query string
//
// On match: 302 to `/admin.php/index/index?referer=<stripped-url>` and
// abort the controller call by returning EMPTY observable.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { EMPTY, Observable } from 'rxjs'

@Injectable()
export class MultitabInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>()
    if (req.method !== 'GET') return next.handle()
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') return next.handle()

    const url = req.originalUrl ?? req.url ?? ''
    if (!url.startsWith('/admin.php/')) return next.handle()

    const q = req.query as Record<string, unknown>
    if (q.ref !== 'addtabs') return next.handle()
    if (q.dialog || q.addtabs) return next.handle()

    // Strip `ref=addtabs` from the URL while preserving the rest.
    const stripped = url
      .replace(/([?&])ref=addtabs(&?)/i, (_m, lead: string, trail: string) => trail === '&' ? lead : '')
      .replace(/\?$/, '')

    const target = `/admin.php/index/index?referer=${encodeURIComponent(stripped)}`
    const res = ctx.switchToHttp().getResponse<Response>()
    res.redirect(302, target)
    return EMPTY
  }
}
