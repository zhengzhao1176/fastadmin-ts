// Browser-side Sentry entry. Bundled by esbuild (npm run build:sentry-browser)
// into `public/assets/js/sentry-browser.bundle.js` and loaded by AdminLTE's
// meta.html BEFORE require.js so any error from the moment the page parses
// is captured.
//
// Session Replay is enabled with `replaysOnErrorSampleRate: 1.0` so every
// session that throws an error is fully replayable (DOM mutations + clicks
// + network for the minutes leading up to the error).
//
// PII defaults conservative: `maskAllText: true` + `blockAllMedia: true`
// so admin data (admin names, customer details, attachment URLs) doesn't
// leak into Sentry. The user can opt back in by setting
// requireConfig.sentry.maskAllText = false.

import * as Sentry from '@sentry/browser'

declare global {
  interface Window {
    Sentry: typeof Sentry
    __sentryInit?: (cfg: BrowserSentryConfig) => void
  }
}

export interface BrowserSentryConfig {
  dsn: string
  environment?: string
  release?: string
  /** 0..1 — fraction of all sessions to replay (off by default to keep storage in check). */
  replaysSessionSampleRate?: number
  /** 0..1 — fraction of sessions with errors to replay (default 1.0 — every error). */
  replaysOnErrorSampleRate?: number
  /** 0..1 — performance trace sampling (default 0 — off). */
  tracesSampleRate?: number
  /** Mask all text content in the replay (default true — privacy-safe). */
  maskAllText?: boolean
  /** Block media in the replay (default true). */
  blockAllMedia?: boolean
  /** Logged-in admin context, if any, attached at init time. */
  user?: { id: string | number; username: string } | null
  /** Custom tags applied to every event. */
  tags?: Record<string, string>
}

window.Sentry = Sentry
window.__sentryInit = function init(cfg: BrowserSentryConfig): void {
  if (!cfg.dsn) return
  Sentry.init({
    dsn: cfg.dsn,
    environment: cfg.environment ?? 'production',
    release: cfg.release,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: cfg.maskAllText ?? true,
        blockAllMedia: cfg.blockAllMedia ?? true,
      }),
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: cfg.tracesSampleRate ?? 0,
    replaysSessionSampleRate: cfg.replaysSessionSampleRate ?? 0,
    replaysOnErrorSampleRate: cfg.replaysOnErrorSampleRate ?? 1.0,
  })
  if (cfg.user) {
    Sentry.setUser({
      id: String(cfg.user.id),
      username: cfg.user.username,
    })
  }
  if (cfg.tags) {
    for (const [k, v] of Object.entries(cfg.tags)) {
      Sentry.setTag(k, v)
    }
  }
}
