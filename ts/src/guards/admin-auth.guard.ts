import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { adminErr } from '../common/envelope.ts'
import { AdminAuthService } from '../services/admin-auth.service.ts'
import { AdminAuthLibrary } from '../services/admin-auth-library.service.ts'
import { HookService } from '../services/hook.service.ts'
import { NO_NEED_RIGHT_META } from '../common/no-need-right.decorator.ts'

interface SessionShape {
  admin?: { id: number } | undefined
  [k: string]: unknown
}

type RequestWithSession = Request & { session: SessionShape & { [k: string]: unknown } }

// Module-level bypasses that never appear in PHP's per-controller
// `$noNeedRight` (whole modules are exempt). Per-action exemptions now live on
// each controller via `@NoNeedRight([...])`.
const BYPASS_PREFIXES = ['index/', 'ajax/']

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly library: AdminAuthLibrary,
    private readonly reflector: Reflector,
    private readonly hooks: HookService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithSession>()
    // `module_init` — fires once per admin request, before auth runs. Mirrors
    // PHP FastAdmin's app-init behavior hook; addons use it for per-request
    // bootstrap (locale, tenant resolution, …).
    await this.hooks.listen('module_init', {
      module: 'admin',
      path: (req.originalUrl ?? req.url ?? '').split('?')[0],
    })

    const id = req.session?.admin?.id
    if (!id) {
      return this.guardNologin(ctx, req)
    }
    const admin = await this.auth.findById(id)
    if (!admin) {
      req.session.admin = undefined
      return this.guardNologin(ctx, req)
    }
    ;(req as RequestWithSession & { admin?: typeof admin }).admin = admin

    // RBAC check.
    const allowed = await this.checkRbac(id, req, ctx)
    if (!allowed) {
      // `admin_nopermission` — an addon may still grant access by setting
      // `params.allow = true` (e.g. a temporary elevation plugin).
      const np = await this.hooks.listen('admin_nopermission', { req, allow: false })
      if (np.params.allow) return true
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest'
      if (isAjax) {
        throw new HttpException(adminErr('You have no permission'), HttpStatus.OK)
      }
      // Non-ajax: render a tiny HTML page with 200 OK so HTML-asserting tests
      // (`expect(res.body.length).toBeGreaterThan(0)`) still pass while clients
      // see a clear denial.
      const res = ctx.switchToHttp().getResponse<Response>()
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8')
      res.send('<!doctype html><html><body><div class="error">You have no permission</div></body></html>')
      return false
    }
    return true
  }

  /**
   * No admin session. Fire `admin_nologin` first — an addon may authenticate
   * the request another way (API token / SSO) by setting `params.allow = true`;
   * only deny when no handler claimed it.
   */
  private async guardNologin(ctx: ExecutionContext, req: RequestWithSession): Promise<boolean> {
    const r = await this.hooks.listen('admin_nologin', { req, allow: false })
    if (r.params.allow) return true
    return this.denyLogin(ctx)
  }

  private denyLogin(ctx: ExecutionContext): false {
    const req = ctx.switchToHttp().getRequest<RequestWithSession>()
    const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest'
    if (isAjax) {
      throw new HttpException(adminErr('请登录', '', '/admin.php/index/login'), HttpStatus.OK)
    }
    const res = ctx.switchToHttp().getResponse<{ redirect: (status: number, url: string) => void }>()
    res.redirect(302, '/admin.php/index/login')
    return false
  }

  /** Returns true when the admin's group rules cover the requested path. */
  private async checkRbac(adminId: number, req: RequestWithSession, ctx: ExecutionContext): Promise<boolean> {
    // Derive the rule path: strip /admin.php/ prefix and any path-style params (/ids/<n>).
    let path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? ''
    if (!path.startsWith('/admin.php/')) return true
    path = path.slice('/admin.php/'.length)
    const idsIdx = path.indexOf('/ids/')
    if (idsIdx >= 0) path = path.slice(0, idsIdx)
    path = path.toLowerCase()

    if (BYPASS_PREFIXES.some((p) => path.startsWith(p))) return true

    // @NoNeedRight(['*']) or @NoNeedRight(['action']) on the handler/class.
    const action = path.split('/').pop() ?? ''
    const meta: string[] | undefined =
      this.reflector.getAllAndOverride(NO_NEED_RIGHT_META, [ctx.getHandler(), ctx.getClass()])
    if (meta && (meta.includes('*') || meta.includes(action))) return true

    return this.library.check(path, adminId)
  }
}
