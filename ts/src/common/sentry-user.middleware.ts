// Sentry user context middleware.
//
// Attaches the logged-in admin (id + username) to the Sentry scope for the
// duration of the request, so any error / breadcrumb is automatically tagged
// with who was doing what. Without this, errors show up as "anonymous" even
// when the admin was clearly logged in.
//
// Only wired into the pipeline when `SENTRY_DSN` is set (see main.ts).
// Without DSN, `Sentry.setUser` is a no-op so this would still be safe to
// register, but skipping it saves a per-request hop.
import { Injectable, NestMiddleware } from '@nestjs/common'
import * as Sentry from '@sentry/nestjs'
import type { Request, Response, NextFunction } from 'express'

type SessionWithAdmin = {
  admin?: { id: number; username: string } | undefined
}

@Injectable()
export class SentryUserMiddleware implements NestMiddleware {
  use = (req: Request, _res: Response, next: NextFunction): void => {
    const session = (req as { session?: SessionWithAdmin }).session
    const admin = session?.admin
    if (admin?.id) {
      Sentry.setUser({
        id: String(admin.id),
        username: admin.username,
      })
    } else {
      // Clear user from previous request (Sentry's scope can leak across
      // requests in long-running processes without explicit reset).
      Sentry.setUser(null)
    }
    // Tag the request with module / controller / action so issues can be
    // filtered by area in Sentry's UI.
    const url = req.originalUrl ?? req.url ?? ''
    const m = url.match(/^\/(admin\.php|index|api)\/([^/?]+)(?:\/([^/?]+))?/)
    if (m) {
      Sentry.setTag('module', m[1] === 'admin.php' ? 'admin' : m[1] ?? 'unknown')
      Sentry.setTag('controller', m[2] ?? 'unknown')
      if (m[3]) Sentry.setTag('action', m[3])
    }
    next()
  }
}
