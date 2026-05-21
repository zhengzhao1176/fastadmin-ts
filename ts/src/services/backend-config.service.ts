// Builds the require-backend.js boot config that the page template inlines
// as `var require = { config: <JSON> }`. Mirrors PHP
// application/common/controller/Backend.php lines 196-226 — the shape MUST
// match (controllername, modulename, jsname, moduleurl, language, site,
// upload, referer, actionname) or the front-end RequireJS bootstrap and
// the i18n lang loader URL both blow up with `?v=undefined` and
// `controllername=undefined` (the original bug we're fixing).
//
// Site fields (name/indexurl/cdnurl/version/timezone/languages) come from
// the `fa_config` table (group=basic). Cached for 30s — these change at
// most when an admin re-saves general/Config.
import { Injectable, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Request, Response } from 'express'
import { ConfigEntity } from '../entities/config.entity.ts'
import { HookService } from './hook.service.ts'

export interface BackendConfig {
  site: {
    name: string
    indexurl: string
    cdnurl: string
    version: string
    timezone: string
    languages: Record<string, string> | string
  }
  upload: {
    cdnurl: string
    uploadurl: string
    bucket: string
    maxsize: string
    mimetype: string
    chunking: boolean
    chunksize: string
    multipart: unknown[]
    storage: string
    multiple: boolean
  }
  modulename: string
  controllername: string
  actionname: string
  jsname: string
  moduleurl: string
  language: string
  referer: string
  /**
   * Cookie prefix used by the browser `createCookie` helper (skin / layout
   * toggles in backend/index.js). FastAdmin's default prefix is empty.
   */
  cookie: { prefix: string }
  /**
   * Session admin snapshot (id + username). Surfaced so iframe-loaded list
   * pages can read `Config.admin.id` from PHP-asset JS (e.g.
   * backend/auth/admin.js:21 disables the "select" checkbox for the row
   * representing the logged-in admin).
   */
  admin?: { id: number; username: string }
  /**
   * Sentry browser-side config snapshot (DSN + sampling). When `SENTRY_DSN`
   * is set in the server env, the same DSN is forwarded to the browser so
   * AdminLTE pages initialise `@sentry/browser` + session replay against
   * the same project. `sentry.user` carries the logged-in admin's id so
   * browser events are tagged at init time.
   */
  sentry?: {
    dsn: string
    environment: string
    release?: string
    replaysSessionSampleRate: number
    replaysOnErrorSampleRate: number
    tracesSampleRate: number
    maskAllText: boolean
    blockAllMedia: boolean
    user?: { id: number; username: string } | null
    tags?: Record<string, string>
  }
}

export interface BuildOpts {
  controllername?: string
  actionname?: string
}

const SITE_KEYS = ['name', 'indexurl', 'cdnurl', 'version', 'timezone', 'languages'] as const
const CACHE_TTL_MS = 30_000

@Injectable()
export class BackendConfigService {
  // Last site snapshot + expiry, keyed by nothing (single tenant).
  private siteCache: { value: BackendConfig['site']; expires: number } | null = null

  constructor(
    @Optional()
    @InjectRepository(ConfigEntity)
    private readonly configs?: Repository<ConfigEntity>,
    @Optional()
    private readonly hooks?: HookService,
  ) {}

  async build(req: Request, opts?: BuildOpts, res?: Response): Promise<BackendConfig> {
    const site = await this.loadSite()
    const { modulename, controllername, actionname } = this.parseRoute(req, opts)
    const jsname = `${modulename === 'admin' ? 'backend' : 'frontend'}/${controllername.replace(/\./g, '/')}`
    const moduleurl = modulename === 'admin' ? '/admin.php' : `/${modulename}`
    const language = this.detectLanguage(req, res)
    const sessionReferer = (req as { session?: { referer?: unknown } }).session?.referer
    const referer = typeof sessionReferer === 'string' ? sessionReferer : ''
    const admin = pickSessionAdmin(req)
    const sentry = buildBrowserSentryConfig(modulename, controllername, admin)

    const config: BackendConfig = {
      site,
      upload: {
        cdnurl: site.cdnurl,
        uploadurl: '/api/common/upload',
        bucket: '',
        maxsize: '10mb',
        mimetype: '*',
        chunking: false,
        chunksize: '2097152',
        multipart: [],
        storage: 'local',
        multiple: false,
      },
      modulename,
      controllername,
      actionname,
      jsname,
      moduleurl,
      language,
      referer,
      cookie: { prefix: '' },
      ...(admin ? { admin } : {}),
      ...(sentry ? { sentry } : {}),
    }
    if (this.hooks) {
      // `upload_config_init` (doc 174) — cloud-storage addons patch the upload
      // block here (uploadurl / cdnurl / storage / multipart …).
      await this.hooks.listen('upload_config_init', { upload: config.upload })
      // `config_init` — addons may patch the rest of the per-request backend
      // config (feature flags, …) before it is serialised into the page.
      await this.hooks.listen('config_init', { config })
    }
    return config
  }

  // Synchronous helper for spots where we can't await (rare). Falls back to
  // cached site or empty values if the cache is cold.
  buildSync(req: Request, opts?: BuildOpts, res?: Response): BackendConfig {
    const site = this.siteCache?.value ?? this.emptySite()
    const { modulename, controllername, actionname } = this.parseRoute(req, opts)
    const jsname = `${modulename === 'admin' ? 'backend' : 'frontend'}/${controllername.replace(/\./g, '/')}`
    const moduleurl = modulename === 'admin' ? '/admin.php' : `/${modulename}`
    const language = this.detectLanguage(req, res)
    const sessionReferer = (req as { session?: { referer?: unknown } }).session?.referer
    const referer = typeof sessionReferer === 'string' ? sessionReferer : ''
    const admin = pickSessionAdmin(req)
    const sentry = buildBrowserSentryConfig(modulename, controllername, admin)
    return {
      site,
      upload: {
        cdnurl: site.cdnurl,
        uploadurl: '/api/common/upload',
        bucket: '',
        maxsize: '10mb',
        mimetype: '*',
        chunking: false,
        chunksize: '2097152',
        multipart: [],
        storage: 'local',
        multiple: false,
      },
      modulename,
      controllername,
      actionname,
      jsname,
      moduleurl,
      language,
      referer,
      cookie: { prefix: '' },
      ...(admin ? { admin } : {}),
      ...(sentry ? { sentry } : {}),
    }
  }

  /** Prime the site cache so buildSync returns real values. */
  async warm(): Promise<void> {
    await this.loadSite()
  }

  private async loadSite(): Promise<BackendConfig['site']> {
    const now = Date.now()
    if (this.siteCache && this.siteCache.expires > now) return this.siteCache.value
    const site = this.emptySite()
    if (!this.configs) {
      this.siteCache = { value: site, expires: now + CACHE_TTL_MS }
      return site
    }
    try {
      const rows = await this.configs.find({ where: { group: 'basic' } })
      for (const row of rows) {
        const name = row.name as string
        if (!(SITE_KEYS as readonly string[]).includes(name)) continue
        const raw = row.value ?? ''
        if (name === 'languages') {
          // Stored as JSON; PHP exposes it as an array.
          try {
            site.languages = JSON.parse(String(raw))
          } catch {
            site.languages = String(raw)
          }
        } else {
          ;(site as Record<string, unknown>)[name] = String(raw)
        }
      }
    } catch {
      // DB unavailable / table missing → defaults are empty strings (PHP parity).
    }
    this.siteCache = { value: site, expires: now + CACHE_TTL_MS }
    return site
  }

  private emptySite(): BackendConfig['site'] {
    return {
      name: '',
      indexurl: '',
      cdnurl: '',
      version: '',
      timezone: '',
      languages: { backend: 'zh-cn', frontend: 'zh-cn' },
    }
  }

  // Route parsing: derive { modulename, controllername, actionname } from
  // the URL. Hint via opts wins (login.html can't be derived unambiguously
  // because PHP would actually report controller=index action=login but the
  // template paths/jsnames differ — keep this overridable).
  parseRoute(req: Request, opts?: BuildOpts): { modulename: string; controllername: string; actionname: string } {
    const url = String(req.originalUrl ?? req.url ?? '/').split('?')[0] ?? '/'
    // Strip leading slash, drop trailing empty segments.
    const parts = url.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter((p) => p.length > 0)
    // Detect module by the first segment. `admin.php/...` → admin, otherwise
    // the first segment (`index`, `api`, ...). Fallback `admin` so all
    // admin-rendered pages are well-behaved.
    let modulename = 'admin'
    let rest: string[] = []
    if (parts.length > 0) {
      const first = parts[0]!
      if (first === 'admin.php') {
        modulename = 'admin'
        rest = parts.slice(1)
      } else if (first === 'index' || first === 'api') {
        modulename = first
        rest = parts.slice(1)
      } else {
        modulename = 'admin'
        rest = parts
      }
    }
    // PHP joins all but the last "action" segment as a dot-separated controller
    // path (e.g. /admin.php/auth/admin/index → controller=auth.admin, action=index).
    let controllername = 'index'
    let actionname = 'index'
    if (rest.length === 1) {
      controllername = sanitizeSegment(rest[0]!)
      actionname = 'index'
    } else if (rest.length >= 2) {
      const last = rest[rest.length - 1]!
      const ctrlSegments = rest.slice(0, -1).map(sanitizeSegment)
      controllername = ctrlSegments.join('.') || 'index'
      actionname = sanitizeSegment(last) || 'index'
    }
    if (opts?.controllername) controllername = opts.controllername
    if (opts?.actionname) actionname = opts.actionname
    return { modulename, controllername, actionname }
  }

  private detectLanguage(req: Request, res?: Response): string {
    // ?lang=xx query parameter wins (matches PHP behaviour for ThinkPHP's
    // langset detection). Setting this also stamps a `lang` cookie so the
    // preference sticks for subsequent requests.
    const query = (req as { query?: Record<string, unknown> }).query ?? {}
    const qLang = typeof query['lang'] === 'string' ? (query['lang'] as string) : ''
    if (qLang && /^[a-z]{2}(-[a-z]{2})?$/i.test(qLang)) {
      const normalised = qLang.replace('_', '-').toLowerCase()
      const lang = /^[a-z]{2}$/.test(normalised)
        ? (normalised === 'zh' ? 'zh-cn' : normalised)
        : normalised
      if (res) {
        try {
          res.cookie('lang', lang, { path: '/', maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false })
        } catch {
          // ignore if res is unusable
        }
      }
      return lang
    }
    // Cookie wins next (matches ThinkPHP's $request->langset() preference for
    // the `think_lang` cookie). Then Accept-Language. Default zh-cn.
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {}
    const cookieLang = cookies['think_lang'] ?? cookies['lang']
    const raw = typeof cookieLang === 'string' ? cookieLang : (req.headers['accept-language'] as string | undefined) ?? ''
    if (!raw) return 'zh-cn'
    const first = String(raw).split(/[;,]/)[0]!.trim().toLowerCase()
    // Normalise xx_YY / xx-YY → xx-yy.
    const normalised = first.replace('_', '-')
    if (/^[a-z]{2}-[a-z]{2}$/.test(normalised)) return normalised
    if (/^[a-z]{2}$/.test(normalised)) {
      // Expand a bare language to PHP's canonical form (zh → zh-cn, en → en).
      return normalised === 'zh' ? 'zh-cn' : normalised
    }
    return 'zh-cn'
  }
}

function sanitizeSegment(s: string): string {
  // Allow letters/digits/underscore/hyphen and lowercase. Anything else → empty.
  const t = s.toLowerCase()
  if (!/^[a-z0-9_.\-]+$/.test(t)) return ''
  return t
}

/**
 * Extract `{ id, username }` from `req.session.admin` when present. Returned
 * value is embedded into `Config.admin` on the page so PHP-asset JS that does
 * `row.id == Config.admin.id` can resolve without TypeError.
 */
function pickSessionAdmin(req: Request): { id: number; username: string } | undefined {
  const sess = (req as { session?: { admin?: unknown } }).session
  const a = sess?.admin
  if (!a || typeof a !== 'object') return undefined
  const rec = a as Record<string, unknown>
  const id = Number(rec.id)
  const username = typeof rec.username === 'string' ? rec.username : ''
  if (!Number.isFinite(id) || id <= 0) return undefined
  return { id, username }
}

/**
 * Build the browser-side Sentry config that ships down in `requireConfig`.
 * Returns `undefined` when `SENTRY_DSN` isn't set so the meta template
 * doesn't emit the loader. Mirrors the server-side defaults (10% session
 * replay sample, 100% error-session replay, no perf tracing).
 */
function buildBrowserSentryConfig(
  modulename: string,
  controllername: string,
  admin: { id: number; username: string } | undefined,
): BackendConfig['sentry'] | undefined {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return undefined
  return {
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    replaysSessionSampleRate: Number(process.env.SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? '0'),
    replaysOnErrorSampleRate: Number(process.env.SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? '1.0'),
    tracesSampleRate: Number(process.env.SENTRY_BROWSER_TRACES_SAMPLE_RATE ?? '0'),
    maskAllText: process.env.SENTRY_MASK_ALL_TEXT !== '0',
    blockAllMedia: process.env.SENTRY_BLOCK_ALL_MEDIA !== '0',
    user: admin ?? null,
    tags: {
      module: modulename,
      controller: controllername,
      runtime: 'browser',
    },
  }
}
