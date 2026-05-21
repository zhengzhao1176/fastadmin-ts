// Sentry MUST be imported first — its `Sentry.init` patches http / express /
// typeorm at require-time, so any module loaded before this won't be
// instrumented. The instrument file is a no-op when SENTRY_DSN is unset.
import './instrument.ts'

import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import * as Sentry from '@sentry/nestjs'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppModule } from './app.module.ts'
import { setupBodyParsing } from './common/body-parser.ts'
import { setupSession } from './common/session-setup.ts'
import { BackendConfigService } from './services/backend-config.service.ts'
import { PhpFallbackFilter } from './filters/php-fallback.filter.ts'
import { SentryUserMiddleware } from './common/sentry-user.middleware.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'error', 'warn'] })

  // CSP — allow the Sentry server origin in connect-src when SENTRY_DSN is
  // set, so the browser SDK can POST envelopes back to it. Parsed from the
  // DSN; without the trailing path so all `/api/<n>/envelope/`, `/replay/`
  // etc. endpoints are covered.
  const sentryOrigin = (() => {
    const dsn = process.env.SENTRY_DSN
    if (!dsn) return undefined
    try {
      const u = new URL(dsn)
      return `${u.protocol}//${u.host}`
    } catch {
      return undefined
    }
  })()

  // Security headers. CSP permissive enough for AdminLTE (inline scripts/
  // styles + self-hosted assets) but still blocks third-party origins.
  app.use(helmet({
    contentSecurityPolicy: {
      // Disable `upgrade-insecure-requests` — helmet adds it by default,
      // which rewrites every http://... URL to https:// before the request
      // hits the network. Our self-hosted Sentry uses plain http on the
      // LAN so the upgrade breaks the connect-src match. The deployment
      // should set HTTPS at the reverse-proxy layer if needed; we don't
      // need the browser-level upgrade here.
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: sentryOrigin
          ? ["'self'", sentryOrigin]
          : ["'self'"],
        workerSrc: ["'self'", 'blob:'], // Sentry replay uses a Web Worker
        frameSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }))

  setupBodyParsing(app)
  setupSession(app)
  // Sentry user middleware — tag every event with the logged-in admin (id +
  // username) so issues are grouped per operator. Runs AFTER session-setup
  // so `req.session.admin` is populated.
  if (process.env.SENTRY_DSN) {
    app.use(new SentryUserMiddleware().use)
  }
  // Static assets at /assets/* (CSS / JS / fonts / images).
  app.useStaticAssets(path.resolve(__dirname, '..', 'public'), { index: false })
  app.enableShutdownHooks()

  // (AdminInternalErrorFilter — the catch-all that reports 5xx to Sentry +
  // converts admin.php/* exceptions to the admin envelope — is registered
  // via APP_FILTER in admin.module.ts so the @Catch() ordering works.)

  // PHP fallback. When `PHP_FALLBACK_HOST` is set, any request that doesn't
  // match a TS route is transparently proxied to the PHP server (typically
  // `127.0.0.1:8787` in the docker stack). This preserves PHP-only features
  // (CMS addon, full scheduler, sql console, etc.) without re-implementing
  // them in TS. Default: disabled — keeps the 519 black-box tests on the
  // pure-TS code path.
  if (process.env.PHP_FALLBACK_HOST) {
    app.useGlobalFilters(new PhpFallbackFilter())
    // eslint-disable-next-line no-console
    console.log(`[fastadmin-ts] PHP fallback enabled → ${process.env.PHP_FALLBACK_HOST}:${process.env.PHP_FALLBACK_PORT ?? '8787'}`)
  }

  // Prime BackendConfigService so the synchronous render-page shortcuts
  // return real site values rather than empties. Best-effort — if fa_config
  // is missing the service degrades to empty strings (PHP parity).
  try {
    const backendConfig = app.get(BackendConfigService, { strict: false })
    await backendConfig.warm()
  } catch {
    // ignore — not all assemblies include BackendConfigService.
  }

  const port = Number(process.env.PORT ?? 8888)
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`[fastadmin-ts] listening on http://127.0.0.1:${port}`)
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failed:', e)
  Sentry.captureException(e)
  void Sentry.flush(2000).finally(() => process.exit(1))
})
