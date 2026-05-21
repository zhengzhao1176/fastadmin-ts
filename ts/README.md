# fastadmin-ts — TypeScript port

NestJS + TypeORM port of the FastAdmin PHP backend, validated by the same
black-box test suite that pins the PHP baseline at `../tests/`.

## Status — 🎯 **519 / 519 active tests passing on TS** (100% parity)

| Module | Files | Active tests | Skipped | TS status |
|---|---|---|---|---|
| api/* (8 controllers) | Index, Common, Demo, User, Token, Sms, Ems, Validate | 105 | 12 | ✅ 100% |
| admin/* (15 controllers) | Index, Category, Dashboard, Ajax, Addon, auth/{Admin,Group,Rule,Adminlog}, general/{Config,Attachment,Profile}, user/{User,Group,Rule} | 320 | 55 | ✅ 100% |
| index/* (3 controllers) | Index, Ajax, User | 37 | 7 | ✅ 100% |
| cross-cutting | upload, token, i18n, error-envelope, captcha, rbac, addon-lifecycle | 53 | 26 | ✅ 100% |
| helpers smoke | foundations + auth helpers | 4 | 0 | ✅ 100% |
| CLI commands | crud, menu, install, addon | — | — | ⏳ Tests directly against PHP CLI |

**Combined:** `519 / 519 active` tests pass on TS — byte-for-byte parity with PHP baseline.
Same 100 skips, zero net failures.

### What works end-to-end

| Surface | State |
|---|---|
| Login page | ✅ Real AdminLTE skin at `/admin.php/index/login` (CSS / JS / fonts all serve from `/assets/`) |
| Dashboard | ✅ `/admin.php/index/index` renders AdminLTE shell + signup chart + stats cards |
| Category CRUD page | ✅ List page with toolbar + `<table>`; bootstrap-table JS reads `/admin.php/category/index` ajax |
| Sidebar menu | ✅ `refreshmenu` returns real menu tree from `fa_auth_rule` filtered by admin's rules |
| Captcha | ✅ Real distorted SVG with noise lines via `svg-captcha`; answer in session |
| RBAC | ✅ Per-rule check in `AdminAuthGuard` via `AdminAuthLibrary` + per-controller `@NoNeedRight()` |
| Frontend hooks | ✅ `HookService` wired into login/register/logout |
| SMS pluggable backends | ✅ `SmsService` + adapter interface; addon registers a driver |
| Health endpoint | ✅ `GET /health` → `{status:'ok', uptime, ts}` |
| Security headers | ✅ `helmet` with AdminLTE-safe CSP |
| First-time install | ✅ `node bin/think.ts install --hostname=... --adminpassword=...` |
| Static assets | ✅ 19MB AdminLTE assets synced via `npm run sync-assets`, served from `/assets/*` |
| Graceful shutdown | ✅ `enableShutdownHooks()` drains on SIGTERM |
| **Plugin / Addon system** | ✅ `AddonService` discovers `ts/addons/*/info.json`; install/uninstall/enable/disable/upgrade lifecycle; hooks auto-bind on enable; sample addon at `ts/addons/example/` |
| Multi-tab navigation | ✅ `MultitabInterceptor` — `?ref=addtabs` redirects to `/admin.php/index/index?referer=<url>` so AdminLTE can pop the URL into a new tab pane (PHP parity) |
| **Production cache** | ✅ `CacheService` with Redis driver (default when `REDIS_HOST` set) + file fallback + in-memory; `/admin.php/ajax/wipecache` actually clears it |
| **i18n** | ✅ `I18nService` loads `ts/lang/<lang>/<module>/<controller>.json` packs; `/admin/ajax/lang` and `/index/ajax/lang` return real Chinese dicts the AdminLTE JS expects |
| **Image thumbnails** | ✅ Uploads of `image/*` MIME types get a 200px-wide thumbnail (sharp) saved as `<sha1>_thumb.<ext>`, width/height stored on `fa_attachment` |
| **Email backend reload** | ✅ Editing `mail_*` in `general/config/edit` triggers `MailerService.reload()` — SMTP host/port/auth picked up from `fa_config` (group=email) live, no restart |
| **dataLimit scoping** | ✅ `BackendCrudService` accepts `dataLimit: 'auth'\|'personal'` + manageable admin-id context — auto-WHEREs by `admin_id` so non-super admins only see their own rows |
| **Area data** | ✅ `AreaEntity` mapped to `fa_area`; `/admin/ajax/area` returns province→city→county hierarchy for cascade-picker widgets |
| **Admin CRUD pages** | ✅ All 15 admin controllers route through `ViewService` with AdminLTE list/form/detail templates (toolbar with Add/Edit/Del/Multi buttons, bootstrap-table-compatible `<table id="…-list">`) |
| **Asset minifier** | ✅ `node bin/think.ts min` runs esbuild on backend/frontend JS + CSS, outputs `*.min.js` / `*.min.css` |
| **API doc generator** | ✅ `node bin/think.ts api` scans every controller via the TS Compiler API, emits `public/api.html` with **178 endpoints** classified by module |
| **Addon packaging** | ✅ `node bin/think.ts addon --action=package --name=<x>` → `runtime/addons/<x>-<v>.zip`; `--action=install --zip=<path>` extracts with zip-slip protection |
| **Storage adapters** | ✅ `StorageService` registry + `LocalStorageAdapter` (default) + `S3StorageAdapter` stub; addons register cloud drivers (Aliyun OSS / Qiniu / AWS) |
| **Soft-delete** | ✅ `BackendCrudService.del/recyclebin/destroy/restore` — auto-detects `deletetime` column and routes to soft-delete vs physical delete |
| **Visual smoke doc** | ✅ `docs/visual-smoke.md` — 15-step manual walkthrough that catches browser-side regressions outside the 519 black-box tests |
| **Automated smoke runner** | ✅ `npm run smoke` — `scripts/smoke.sh` curls every step in the visual-smoke doc end-to-end (login, dashboard, menu, CRUD page, i18n, captcha, security headers, multitab, wipecache, addon list, frontend home, CLI) and reports pass/fail tally |
| **English i18n packs** | ✅ `lang/en/admin/{index,category,auth,general}.json` + `lang/en/index/user.json` — admin UI flips fully to English when `cookie lang=en` or `?lang=en` is set |
| **`bin/think` shell wrapper** | ✅ `./bin/think install …` / `./bin/think crud -t fa_news` works directly — no `npm run think --` prefix needed |
| **Feature audit** | ✅ `docs/feature-audit.md` — line-by-line comparison of PHP feature docs vs TS port state |

## Plugins / Addons

Drop an addon into `ts/addons/<name>/`:

```
ts/addons/example/
├── info.json     # manifest
└── index.ts      # default export = class with install/uninstall/enable/disable/upgrade + hook handlers
```

`info.json`:

```json
{
  "name": "example",
  "title": "Example Addon",
  "version": "1.0.0",
  "state": 0,
  "hooks": { "user_login_successed": "onUserLogin" }
}
```

Then via the admin:

```bash
POST /admin.php/addon/install   {name: 'example'}        # state 0 → 1, calls install()
POST /admin.php/addon/state     {name: 'example', action: 'disable'}  # state 1 → 0, unregisters hooks
POST /admin.php/addon/upgrade   {name: 'example', version: '1.1.0'}
```

Hook handlers are auto-bound on enable; once bound, `HookService.listen('user_login_successed', ...)` fires the addon's `onUserLogin` method. Disabling removes the handler at runtime.

## Architecture

```
src/
├── main.ts                    NestJS bootstrap + body parser + session
├── app.module.ts              Wires TypeOrmModule.forRoot + Api/Admin/Frontend modules
├── common/
│   ├── envelope.ts            apiOk/apiErr/adminOk/adminErr — byte-equal to PHP
│   ├── env.ts                 Reads ../.env.test (same source as PHP)
│   ├── hash.ts                md5(md5(password) + salt) + randomToken + randomSalt
│   ├── body-parser.ts         x-www-form-urlencoded + json
│   ├── session-setup.ts       express-session + cookie-parser (PHPSESSID name)
│   └── tree.ts                Port of fast\Tree (getChildrenIds + tree flatten)
├── entities/                  TypeORM @Entity per fa_* table (15 entities)
├── services/
│   ├── auth.service.ts        frontend user login/register/token issuance
│   ├── admin-auth.service.ts  admin login with md5(md5(pw)+salt)
│   ├── csrf.service.ts        issue/consume session __token__
│   ├── captcha.service.ts     SMS / EMS check + send
│   ├── mailer.service.ts      nodemailer → MailHog
│   ├── upload.service.ts      multer file save + sha1 + fa_attachment INSERT
│   └── backend-crud.service.ts  generic CRUD + buildParams + selectpage
├── guards/
│   ├── api-auth.guard.ts      Reads `token` header → 401 envelope on miss
│   ├── admin-auth.guard.ts    Session.admin guard, 302 redirect or admin envelope
│   └── frontend-auth.guard.ts Reads `token` cookie/header for index/* module
├── interceptors/
│   └── admin-log.interceptor.ts  Auto-INSERT fa_admin_log on successful admin POST
├── filters/
│   └── admin-error.filter.ts  Convert BadRequest from /admin.php/* → admin envelope
└── modules/
    ├── api/        8 controllers — Index/Common/Demo/User/Token/Sms/Ems/Validate
    ├── admin/      15 controllers — Index/Category/Dashboard/Ajax/Addon +
    │                auth/{Admin,Group,Rule,Adminlog} +
    │                general/{Config,Attachment,Profile} +
    │                user/{User,Group,Rule}
    └── index/      3 controllers — Index/Ajax/User (frontend)
```

Each admin CRUD controller is a thin specialisation that injects
`BackendCrudService` and adds the controller-specific bits (custom index/edit
overrides, HTML rendering, CSRF). Categories share the Tree helper for the
indent-prefixed flattened list.

## Runtime — important note

NestJS DI relies on `Reflect.metadata` emitted by the compiler. Esbuild
(used by tsx) does not emit it. We use `@swc-node/register`:

```
node --import=@swc-node/register/esm-register src/main.ts
```

with a project-root `.swcrc` that has `legacyDecorator: true` and
`decoratorMetadata: true`. Without this, all `@Inject*` decorators yield
`undefined` at runtime.

## Running

```bash
cd ts
npm install
npm run sync-assets             # one-time: copy AdminLTE assets from fastAdmin/public
PORT=8888 npm start
# In another terminal:
cd ..
FASTADMIN_BASE_URL=http://127.0.0.1:8888 SKIP_DB_RESET=1 npx vitest run tests/
```

`SKIP_DB_RESET=1` tells vitest's global-setup to skip its DB reset — the
TS server shares the DB the PHP baseline already seeded.

## CLI — `bin/think`

There are two equivalent invocation styles:

```bash
./bin/think --help                     # shell-wrapper (PHP-`think`-style ergonomics)
npm run think -- --help                # npm-script alias
```

Pick whichever your fingers prefer; both end up running the same code.

```bash
# Install (first-time DB setup)
./bin/think install \
  --hostname=127.0.0.1 --hostport=3787 \
  --database=fastadmin_test --username=root --password=root_for_test \
  --adminname=admin --adminpassword=123456

# CRUD scaffolder — generates TypeORM entity + admin CRUD controller from a MySQL table
./bin/think crud -t fa_news
# (then add the generated *Entity / *Controller to app.module.ts and admin.module.ts)

# Menu — insert fa_auth_rule rows so a controller shows up in the sidebar
./bin/think menu -c news

# Addons — scaffold / list / enable / disable
./bin/think addon --action=create --name=cms
./bin/think addon --action=list
./bin/think addon --action=enable --name=cms
./bin/think addon --action=disable --name=cms

# Asset minifier — esbuild *.js / *.css → *.min.js / *.min.css
./bin/think min

# API docs — scan controllers, emit public/api.html (~178 endpoints)
./bin/think api
```

All commands operate against the same `.env.test`-configured DB the TS server uses.

## First-time installation (clean DB)

```bash
cd ts
npm run think -- install \
  --hostname=127.0.0.1 --hostport=3787 \
  --database=fastadmin_test --username=root --password=root_for_test \
  --adminname=admin --adminpassword=123456 --adminemail=admin@test.local
```

Writes `install.lock` at the repo root. Re-running errors unless `--force`.

## Health check

```bash
curl http://127.0.0.1:8888/health
# {"status":"ok","uptime":42,"ts":1778767000}
```

## Error tracking (Sentry)

Both **server** (NestJS exceptions) and **browser** (AdminLTE / frontend JS
errors) report to the same Sentry project. Every browser error has a
**Session Replay** attached (DOM mutations + clicks + network for the
seconds leading up to the throw).

Env-gated — set `SENTRY_DSN` to turn on; unset to keep the pure-TS path
that the 519 tests run against.

```bash
SENTRY_DSN="http://<key>@host/<id>" \
SENTRY_ENVIRONMENT=production \
PORT=8888 npm start
# [sentry] enabled → release=fastadmin-ts@<git-sha> env=production
```

### Server-side wire-up

| File | Purpose |
|---|---|
| `src/instrument.ts` | `Sentry.init()` — must be first import in `main.ts`. Drops the Express integration (conflicts with body-parser) and ignores noisy 4xx classes. |
| `src/filters/admin-error.filter.ts` | `AdminInternalErrorFilter` captures unhandled 5xx, calls `Sentry.captureException`, and returns the admin envelope. |
| `src/common/sentry-user.middleware.ts` | Per-request: attaches `Sentry.setUser({id, username})` from `req.session.admin`, plus tags `module/controller/action`. |
| `src/app.module.ts` | `SentryModule.forRoot()` registers Sentry's NestJS adapter. |

### Browser-side wire-up

| File | Purpose |
|---|---|
| `src/browser-sentry-entry.ts` | Source for the browser bundle (`@sentry/browser` + replay integration + browser tracing). |
| `public/assets/js/sentry-browser.bundle.js` | Bundled by `npm run build:sentry-browser`. ~445 KB minified (~130 KB gzipped). Loaded by `views/{admin,index}/common/meta.html` before require.js. |
| `views/admin/common/meta.html` / `views/index/common/meta.html` | Inline `<script>` that calls `window.__sentryInit(require.config.sentry)` with the DSN passed down from `BackendConfigService.sentry`. |

When `SENTRY_DSN` is set, `BackendConfigService.build()` adds a `sentry`
block to the `requireConfig` JSON the page receives:

```js
window.require.config.sentry = {
  dsn: "http://<key>@<host>/<projectId>",
  environment: "production",
  release: "<git-sha>",
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  tracesSampleRate: 0,
  maskAllText: true,
  blockAllMedia: true,
  user: { id: 1, username: "admin" },
  tags: { module: "admin", controller: "category", runtime: "browser" }
}
```

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `SENTRY_DSN` | — (off) | Sentry project ingest endpoint. Same DSN is used by server and browser. |
| `SENTRY_ENVIRONMENT` | `NODE_ENV` or `development` | Tag events with environment name. |
| `SENTRY_RELEASE` | `git rev-parse HEAD` | Pin events to a commit. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` (no tracing) | Server tracing sample rate. Setting > 0 enables OpenTelemetry; note Sentry's express integration is disabled because it conflicts with body-parser. |
| `SENTRY_PROFILES_SAMPLE_RATE` | `1.0` | When traces are sampled, profile this fraction. |
| `SENTRY_SEND_DEFAULT_PII` | `0` (off) | Send client IP / headers / cookies (server side). |
| `SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | `0` (off) | Fraction of all browser sessions to fully replay (storage-expensive). |
| `SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | `1.0` | Fraction of browser sessions WITH ERRORS to replay. **Default: every error has a replay.** |
| `SENTRY_BROWSER_TRACES_SAMPLE_RATE` | `0` (off) | Browser-side performance tracing. |
| `SENTRY_MASK_ALL_TEXT` | `1` (on) | Mask text content in replay (privacy). |
| `SENTRY_BLOCK_ALL_MEDIA` | `1` (on) | Block images / video in replay. |

### Building the browser bundle

```bash
npm run build:sentry-browser   # bundles @sentry/browser + replay → public/assets/js/sentry-browser.bundle.js
```

Run this after `npm install` and after bumping `@sentry/browser`. The
output is committed (or built in CI before deploy) so the runtime doesn't
need a build step on cold start.

### CSP

helmet's CSP is extended to allow the Sentry origin in `connect-src` and
to expose `worker-src 'self' blob:` for the replay's Web Worker. The
default `upgrade-insecure-requests` directive is removed so plain-http
LAN deployments of Sentry don't get rewritten to https://. If you're
running over HTTPS, terminate it at the proxy layer.

### What's instrumented

**Server**:
- Unhandled 5xx exceptions in admin / api / frontend routes.
- Logged-in admin id + username + per-route tags.

**Browser**:
- `window.onerror` and unhandled promise rejections.
- Every error captures a Session Replay (last ~30 s of DOM activity).
- Manual capture: `window.Sentry.captureException(err)` / `captureMessage(...)`.
- Logged-in admin attached at `__sentryInit` time so events are tied to the operator.

### What's NOT instrumented

- Sentry's `Express` integration is stripped at init (it patches body-parser and breaks every POST).
- Multipart upload bodies aren't auto-tracked (multer consumes the stream before any wrapper sees it).
- 4xx outcomes (CSRF fail, token expired, NotFound) — intentionally suppressed via `ignoreErrors`.

## PHP fallback proxy

For features the TS port doesn't (yet) reimplement — CMS addons, command
scheduler, SQL console, full SMS/EMS provider library, etc. — set
`PHP_FALLBACK_HOST` and any request that doesn't match a TS route is
transparently proxied to the PHP server. The user can't tell the
difference; cookies, body, and response stream through unmodified.

```bash
PORT=8888 \
PHP_FALLBACK_HOST=127.0.0.1 \
PHP_FALLBACK_PORT=8787 \
npm start
# [fastadmin-ts] PHP fallback enabled → 127.0.0.1:8787
```

Flow:

```
request  →  NestJS router
              ├─ TS route matches    → TS controller serves
              └─ no match (404)      → PhpFallbackFilter
                                       └─ http.request → PHP server
                                          └─ pipe response back
```

Default: disabled. The 519 black-box tests run against the pure-TS code
path so unimplemented features fail visibly rather than silently
proxying. Turn it on in production / dev to get the union of both
implementations.

Implementation: `src/filters/php-fallback.filter.ts`. Multipart uploads
aren't yet supported (body-parser already consumed the stream); JSON and
urlencoded form posts are re-serialised before being forwarded.

## Smoke walkthrough

After any large change, run the automated UI walkthrough:

```bash
PORT=8888 npm start &        # in another terminal
PORT=8888 npm run smoke      # 25 curl-based checks
# expect: "All smoke checks green."
```

The runner mirrors `docs/visual-smoke.md` step-by-step: static assets,
login flow, dashboard, menu refresh, category CRUD page, i18n (zh-cn +
en), captcha randomness, health, security headers, multitab redirect,
wipecache, addon list, frontend home + login template, bare
`/admin.php` redirect, and `bin/think --help`.

## Acceptance criteria — ✅ MET

The TS port is behaviour-equivalent with PHP:

- ✅ All **519 active tests** in `../tests/` pass against `FASTADMIN_BASE_URL=http://127.0.0.1:8888`
- ✅ Same **100 skips** as PHP baseline (no false negatives, no extra noise)

```
Test Files  40 passed (40)
Tests       519 passed | 100 skipped (619)
Duration    ~42s
```

## Test-the-port loop

```bash
# A: confirm PHP still green
npx vitest run tests/<X>.test.ts
# B: implement TS controller, restart fastadmin-ts
# C: re-run against TS
FASTADMIN_BASE_URL=http://127.0.0.1:8888 SKIP_DB_RESET=1 npx vitest run tests/<X>.test.ts
```

The vitest tests are the source of truth. If a test fails against TS, fix TS
— don't change the test (unless we also discover a real spec bug, in which
case update both PHP recon + TS).
