// Sentry initialization — MUST be imported before any other module so the
// SDK can instrument http / express / typeorm at require-time. Per
// @sentry/nestjs README: `import './instrument'` at the top of main.ts.
//
// Env-gated: if SENTRY_DSN is unset, Sentry stays disabled and the rest of
// the app behaves exactly as before. The 519 black-box tests run without
// SENTRY_DSN so the test path is untouched.
//
// Defaults:
//   environment = NODE_ENV || 'development'
//   release     = `git rev-parse HEAD` (when available) — pinned to commit
//   tracesSampleRate = 0.1  (10% of requests traced)
//   sendDefaultPii   = false (no IP/headers/cookies by default)
//
// To enable:
//   SENTRY_DSN=http://<key>@host/<id> npm start
import * as Sentry from '@sentry/nestjs'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import { execSync } from 'node:child_process'

function gitRev(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

const dsn = process.env.SENTRY_DSN
if (dsn) {
  // Performance / tracing is opt-in: SENTRY_TRACES_SAMPLE_RATE > 0. Default
  // off — see filterIntegrations() below for why.
  const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0')
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? gitRev() ?? `fastadmin-ts@${process.env.npm_package_version ?? '0.0.1'}`,
    // Strip Sentry's Express integration. Its `patchLayer` wraps every
    // express middleware including body-parser; the wrapper double-reads
    // `req` which throws `stream is not readable` on every POST. We keep
    // error-capturing behaviour intact (errors flow through NestJS' filters
    // and `Sentry.captureException`) but lose automatic span instrumentation
    // for express routes — acceptable trade-off since the @sentry/nestjs
    // setup module re-installs interceptor-level instrumentation that
    // doesn't conflict.
    integrations: (defaults) => {
      const filtered = defaults.filter((i) => i.name !== 'Express')
      return tracesSampleRate > 0 ? [...filtered, nodeProfilingIntegration()] : filtered
    },
    tracesSampleRate,
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '1.0'),
    // PII: off by default. Set SENTRY_SEND_DEFAULT_PII=1 to enable IP / headers.
    sendDefaultPii: process.env.SENTRY_SEND_DEFAULT_PII === '1',
    // Drop noisy classes BEFORE they hit Sentry. The 4xx ones are normal
    // business outcomes (CSRF, bad input, login required) and would flood
    // Sentry with thousands of events per day. EmptyError is RxJS's signal
    // when an interceptor returns `EMPTY` (e.g. MultitabInterceptor aborts
    // a controller call after issuing a redirect) — it's by design, not a
    // bug.
    ignoreErrors: [
      'NotFoundException',
      'Token verification error',
      'PayloadTooLargeException',
      'EmptyError',
      'no elements in sequence',
      // PhpFallbackFilter already sent the proxied PHP response; downstream
      // filters trying to write to the closed response produce this.
      'Cannot set headers after they are sent to the client',
    ],
    beforeSend(event, hint) {
      // Drop NestJS HttpException instances with status < 500 — these are
      // controlled business responses (BadRequest, Unauthorized, etc.) that
      // already reach the user via the admin envelope. Sentry should only
      // see things that broke unexpectedly.
      const err = hint?.originalException as { status?: number; getStatus?: () => number } | undefined
      const status = typeof err?.getStatus === 'function' ? err.getStatus() : err?.status
      if (typeof status === 'number' && status < 500) return null
      return event
    },
  })
  // eslint-disable-next-line no-console
  console.log(`[sentry] enabled → release=${Sentry.getClient()?.getOptions().release} env=${Sentry.getClient()?.getOptions().environment}`)
}
