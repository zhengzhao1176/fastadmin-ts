// Catch BadRequest/InternalServerError thrown from admin.php/* routes (often
// by multer's strict multipart parser) and convert into the admin envelope
// shape so clients always see {code, msg, ...} instead of NestJS's default
// {statusCode, message, error}.
//
// Also reports 5xx exceptions to Sentry (when `SENTRY_DSN` is set). 4xx
// errors are business-level outcomes (bad input, csrf fail) and stay out of
// Sentry to avoid drowning real bugs in noise.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import * as Sentry from '@sentry/nestjs'
import type { Response, Request } from 'express'
import { adminErr } from '../common/envelope.ts'

@Catch(BadRequestException, PayloadTooLargeException)
export class AdminMultipartErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()
    const url = req.originalUrl ?? req.url ?? ''
    if (!url.startsWith('/admin.php/')) {
      // Fall back to default behaviour for non-admin routes.
      res.status(exception.getStatus()).json(exception.getResponse())
      return
    }
    const msg = typeof exception.message === 'string' ? exception.message : 'Bad request'
    res.status(200).json(adminErr(msg))
  }
}

/**
 * Generic catch-all that BOTH (a) reports 5xx exceptions to Sentry and (b)
 * converts admin.php/* 5xx into the admin envelope shape. Replaces the
 * stock `SentryGlobalFilter` from `@sentry/nestjs/setup`, which would
 * shadow the admin-envelope conversion and leak NestJS' default
 * `{statusCode, message, error}` JSON to the AdminLTE UI.
 *
 * NestJS picks the MOST SPECIFIC `@Catch(...)` filter first. This
 * `@Catch()` (no args = match-all) only fires for exceptions that other
 * filters (e.g. `AdminMultipartErrorFilter`, `PhpFallbackFilter`,
 * controller-level filters) didn't catch.
 */
@Catch()
export class AdminInternalErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()
    const url = req.originalUrl ?? req.url ?? ''

    // NotFoundException belongs to PhpFallbackFilter (when enabled). When
    // that filter isn't configured (no `PHP_FALLBACK_HOST`), produce the
    // standard 404 response inline — re-throwing here just hangs the
    // request because no downstream filter catches it.
    if (exception instanceof NotFoundException) {
      if (process.env.PHP_FALLBACK_HOST) {
        // PhpFallbackFilter is registered globally — re-throw so Nest's
        // filter resolver picks the more-specific @Catch(NotFoundException).
        throw exception
      }
      // Default 404 behaviour.
      const body = exception.getResponse()
      if (typeof body === 'string') res.status(404).send(body)
      else res.status(404).json(body)
      return
    }

    // If the response has already been written (typically by an upstream
    // filter or by the PHP fallback pipe), don't try to write again — that
    // produces a no-op-but-noisy "Cannot set headers after they are sent".
    if (res.headersSent) {
      return
    }

    // HTTP status: pull from Nest HttpException, otherwise treat as 500.
    const status = exception instanceof HttpException ? exception.getStatus() : 500

    // Report genuine 5xx to Sentry. 4xx are business-level rejections (bad
    // CSRF, missing fields) — they don't belong in error tracking.
    if (status >= 500 && process.env.SENTRY_DSN) {
      Sentry.captureException(exception, {
        tags: { url, http_status: String(status) },
      })
    }

    if (!url.startsWith('/admin.php/')) {
      // Default behaviour for non-admin routes.
      if (exception instanceof HttpException) {
        res.status(status).json(exception.getResponse())
      } else {
        res.status(500).json({ statusCode: 500, message: 'Internal server error' })
      }
      return
    }

    const msg = (exception instanceof Error && typeof exception.message === 'string')
      ? exception.message
      : 'Internal server error'
    res.status(200).json(adminErr(msg))
  }
}
