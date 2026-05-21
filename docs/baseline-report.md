# PHP Baseline Verification Report

**Generated**: 2026-05-11 (last revalidated 2026-05-13)
**Stack**: Docker (PHP 7.4-cli + MySQL 8 + Redis 7)
**Test runner**: Vitest 2.1.x + axios + tough-cookie

## Upstream version pin

FastAdmin source is vendored under `fastAdmin/` (not a git submodule). Baseline
was captured against:

| Item | Value |
|---|---|
| FastAdmin version constant | `1.6.2.20260323` (from `application/config.php`) |
| install.sql shipping date | `2024-09-03 15:05:25` |
| Source tree fingerprint (php+html+json+sql, excl runtime/vendor/uploads) | `b1b81041fe6537e0db340ab5aac62e632995477f0347c158886db0debd1ee451` |
| PHP-only fingerprint (excl views) | `20d6e58cf78deb5982cb9b72e64b7abb6499ecabd1ceb4fa3a15642a5561de9f` |
| Source-tree file count (php/html, excl runtime/vendor) | 397 |

Recompute the fingerprint to verify upstream hasn't drifted:

```bash
cd fastAdmin && find . -type f \( -name "*.php" -o -name "*.html" -o -name "*.json" -o -name "*.sql" \) \
  -not -path "./runtime/*" -not -path "./vendor/*" -not -path "./public/uploads/*" \
  -not -path "*install.lock*" -not -name ".env" -print0 \
  | sort -z | xargs -0 shasum -a 256 | shasum -a 256
```

If the hash differs from above, the baseline below may need re-validation.

## Headline numbers

```
Test Files  40 passed (40)
Tests       519 passed | 100 skipped | 0 failed (619)
Active pass rate: 100% (519 / 519)
Skip rate: 16.2% (100 / 619)
Duration:    ~66s end-to-end
```

Most recent change: added MailHog SMTP capture (`docker/docker-compose.yml`), unskipped 3
mail-dependent tests in `tests/admin/general/Config.test.ts` (emailtest happy/bad-receiver)
and `tests/api/Ems.test.ts` (mail arrival).

## Phase-by-phase breakdown

| Phase | Files | Active tests | Skipped |
|---|---|---|---|
| Phase 20 (HTTP controller tests) | 26 + 1 smoke | ~424 | ~80 |
| Phase 30 (cross-cutting) | 7 files | ~57 | ~14 |
| Phase 40 (CLI commands) | 6 files | ~35 | ~8 |

## Coverage map

### Phase 20 — Controllers (26 + 1 smoke)

| Module | Test files |
|---|---|
| admin | Index, Ajax, Dashboard, Category, Addon, auth/{Admin,Group,Rule,Adminlog}, general/{Config,Attachment,Profile}, user/{User,Group,Rule} — 15 |
| api | Common, Demo, Ems, Index, Sms, Token, User, Validate — 8 |
| index | Index, Ajax, User — 3 |

### Phase 30 — Cross-cutting (7)

- `rbac.test.ts` — super vs subadmin permission matrix + data range
- `captcha.test.ts` — `/api/common/captcha` image, frontend register without captcha
- `token.test.ts` — UUID format, expiry, refresh, concurrent tokens, Mysql driver
- `i18n.test.ts` — default zh-cn, non-allowed lang fallback (cookie/query switching skipped — upstream `lang_switch_on=false`)
- `upload.test.ts` — admin/api normal + chunked + bad mimetype + DB writeback
- `error-envelope.test.ts` — api vs admin/index envelope shapes side-by-side
- `addon-lifecycle.test.ts` — `get_table_list` happy path; market-API tests skipped (no fastadmin.net mock)

### Phase 40 — CLI commands (6)

- `crud.test.ts` — `php think crud` end-to-end (generate files, --force, --menu, --delete, syntax check)
- `menu.test.ts` — `php think menu -c <controller>` writes `fa_auth_rule`
- `min.test.ts` — `php think min` (most cases skipped because container lacks node/grunt)
- `addon.test.ts` — `php think addon -c create|enable|disable|package|refresh`
- `api.test.ts` — `php think api` generates `api.html`
- `install.test.ts` — `php think install -a -o -u -p -d -n` into a fresh DB; cleanup restores `.env`, `install.lock`, `admin.php`

## Triage of failures encountered & resolved

### Phase 99 baseline pass (originally 49 failures)

**Test bugs — fixed (~38)**

Schema, fixture, and assertion errors in the test code itself.

| Pattern | Count | Fix |
|---|---|---|
| `fa_sms`/`fa_ems` lack `updatetime`; tests included it in INSERT | 13 | Drop column |
| `fa_admin.username` is `varchar(20)`; fixture generated 22 chars → silent truncation | 5+ | Shorten `uniqueSuffix` to 8 chars |
| admin/index envelopes lack `time`; tests asserted `typeof r.time` | 5 | Strip `r.time` assertions from non-api tests |
| `fa_admin.group_id` doesn't exist (relation in `fa_auth_group_access`) | 2 | Removed from SELECT |
| Admin ajax list returns bare `{total, rows}` (no envelope) | 3 | Update assertions |
| `makeAdmin` defaulted to group_id=2 with limited rules → token-fetch denials | 6 | Default to group_id=1; opt-in subadmin |
| `admin/category/add` needs `row[weigh]` for afterInsert hook | 1 | Add `weigh: 0` |
| `api/Demo` returns string IDs (PHP behaviour) | 1 | `id: '1'` |
| `admin/auth/Rule::edit` actually enforces uniqueness | 1 | Flip expectation |
| `admin/Addon::testdata` returns code=1 for non-existent | 1 | Flip expectation |
| `admin/user/Group::add` success returns empty msg | 1 | Drop `msg.length` |

**Spec / recon errors — fixed (3)**

| Spec | Issue |
|---|---|
| `task/00-foundations/07-conventions.md` | `time` field only exists in api envelopes |
| `task/specs/admin-user-User.md` | `add()` skips validator / password-hash (PHP quirk) |
| `task/specs/admin-auth-Rule.md` | Flagged a non-existent name-uniqueness bug |

**PHP behaviour — captured with `it.skip` (8)**

| Symptom | Root cause |
|---|---|
| `GET /admin.php/user/user/add` → 500 | Upstream `view/user/user/add.html` missing |
| `GET /admin.php/general/config/add` → 500 | Same — `view/general/config/add.html` missing |
| Admin-created user can't login via api | `Backend::add()` doesn't hash password / no `beforeInsert` |
| `admin/user/user/edit` `unique:user` doesn't exclude current id | TP5 unique rule limitation |
| `OPTIONS /api/common/init` → 403 | `Api::_initialize` ignores OPTIONS preflight |
| `/index/ajax/lang?callback=` ignored | PHP hardcodes `define` |
| frontend login UUID PK collision (flaky) | `Random::uuid()` uses `mt_rand` |
| subadmin RBAC matrix can't fetchToken | Subadmin lacks form-page access |

### Phase 30 / 40 integration — additional failures encountered & fixed

| Issue | Resolution |
|---|---|
| `php think install` flag names — `-a` is hostname (not `-h`), `-o` is hostport (not `-P`) | Updated install test to use correct flags |
| install command DELETES `install.lock`, REWRITES `.env`, and RENAMES `public/admin.php` | Test wraps each destructive case in try/finally that restores all three |
| `i18n` cookie/query switching: `lang_switch_on=false` in upstream config | 3 switching tests marked `it.skip` |
| Frontend captcha test originally used `/api/user/register` which always calls `Sms::check` | Switched to `/index/user/register` which respects `user_register_captcha=''` |
| `php think api -c User` requires fully qualified class name | Use `app\api\controller\User` |
| `api -c User` doesn't strip other controllers from the rendered HTML | Removed the exclusion assertion |
| `admin/index/login` bad-token returns `data.token` (not `data.__token__`) | Fixed envelope test |
| `0-byte file upload` → PHP 500 | Marked skip |
| RBAC list endpoint returns bare `{total, rows}` not envelope | Updated assertions |

## Infrastructure / runtime changes applied

To make the baseline runnable at all:

1. **`fastAdmin/application/extra/fastadmin.php`** (auto-written by `scripts/seed.ts`):
   ```php
   return [
     'login_captcha'         => false,
     'login_failure_retry'   => false,
     'user_register_captcha' => '',   // disable frontend register captcha
   ];
   ```

2. **`fastAdmin/application/common/behavior/TestSmsEmsStub.php`** + `tags.php` registration:
   Test-only hook stubs returning `true` for `sms_send/sms_check/ems_send/ems_check`,
   replacing what a production SMS/email addon would provide.

3. **`tests/helpers/fixtures.ts`**:
   - `uniqueSuffix()` returns 8 chars (fits `fa_admin.username varchar(20)`)
   - `makeAdmin` defaults to `group_id=1` (super); subadmin tests opt-in via `{ group_id: 2 }`

4. **`tests/helpers/cli.ts`** (new for Phase 40): wraps `docker exec ... php think` so CLI tests bypass HTTP.

5. **`tests/cli/install.test.ts`**: snapshots & restores `.env`, `install.lock`, and `public/admin.php` because `php think install` mutates them.

## File layout

```
docs/
└── baseline-report.md                  (this file)

tests/
├── helpers/
│   ├── http.ts            # axios + cookie-jar + token-header wrapper
│   ├── auth.ts            # loginAsAdmin / loginAsApiUser / loginAsFrontUser
│   ├── fixtures.ts        # makeAdmin / makeUser / makeAuthGroup / etc.
│   ├── cli.ts             # runThink + docker exec helpers (phase 40)
│   ├── global-setup.ts    # one resetDb() per vitest process
│   └── __smoke__.test.ts  # 8 sanity tests
├── admin/   15 controller tests
├── api/     8 controller tests
├── index/   3 controller tests
├── cross-cutting/  7 tests (rbac, captcha, token, i18n, upload, error-envelope, addon-lifecycle)
└── cli/     6 tests (crud, menu, min, addon, api, install)

scripts/
├── db.ts, hash.ts         # MySQL + password hashing
├── seed.ts                # test fixtures + config overrides
└── reset-db.ts            # DROP → install SQL → seed

task/
├── README.md, INDEX.md, _templates/
├── 00-foundations/ (8 task files — done)
├── 10-recon/       (30 task files — done; 26 spec outputs in task/specs/)
├── 20-write-tests/ (27 task files — done)
├── 30-cross-cutting/ (8 task files — done)
├── 40-cli/         (7 task files — done)
└── 99-baseline-verification.md (this report)
```

## Acceptance criteria for the TypeScript port

The TS replica is considered behaviour-equivalent when:

- All **516 active tests** pass against the TS implementation
- Skipped tests stay skipped (or pass — even better)
- New tests added later for fixtures we don't currently mock (fastadmin market API, real SMS/email) remain skipped on PHP and on TS

## 102 skips — distribution

- **Upstream PHP source bugs** (missing templates, hardcoded JSONP callback, etc.): ~10
- **Needs external service mock** (fastadmin.net market API, SMTP server): ~30
- **Needs heavy fixture** (sample-addon.zip, custom captcha fixture): ~10
- **Recon ambiguities** ("Unclear from code"): ~20
- **Permission-isolation matrix** (subadmin tests requiring deeper setup): ~12
- **Config-flag dependent** (lang_switch_on, login_captcha, etc.): ~10
- **CLI container limitation** (no node/grunt for `php think min`): ~5
- **Flaky / production-only** (Redis token driver, real OPTIONS preflight): ~5

## How to run

```bash
# Bring up the stack (idempotent)
bash scripts/start-server.sh

# Seed / reset the test DB (idempotent)
npx tsx scripts/reset-db.ts

# Run all tests
npx vitest run

# Run a specific phase
npx vitest run tests/cli/
npx vitest run tests/cross-cutting/

# Tear down
bash scripts/stop-server.sh
```

## Status

✅ **PHP baseline locked.** 519 active tests, 0 failures, ~66s end-to-end across 40 files.

This file is the source of truth for what behaviour the TS replica must reproduce.

## TS port progress (`ts/`)

A NestJS + TypeORM port at `ts/` reproduces the PHP behaviour validated by the
same black-box vitest suite.

**Final state: 🎯 `519 / 519` active tests pass against TS** — full parity
with PHP. Same 100 skips, zero failures.

```
Test Files  40 passed (40)
Tests       519 passed | 100 skipped (619)
Duration    ~42s
```

| Status | Module / Surface | Pass count |
|---|---|---|
| ✅ | api/* (8 controllers) — Index, Common, Demo, User, Token, Sms, Ems, Validate | 105 / 105 |
| ✅ | admin/Index (login/logout/index+refreshmenu) | 18 / 18 |
| ✅ | admin/Category | 15 / 15 |
| ✅ | admin/Dashboard | 4 / 4 |
| ✅ | admin/general/Profile, Config, Attachment | 13 + 28 + 19 = 60 |
| ✅ | admin/auth/Admin, Group, Rule, Adminlog | 26 + 21 + 25 + 18 = 90 |
| ✅ | admin/user/User, Group, Rule | 11 + 11 + 17 = 39 |
| ✅ | admin/Ajax (lang, upload, weigh, wipecache, category, area, icon) | 24 / 24 |
| ✅ | admin/Addon (config/install/uninstall/state/local/upgrade/testdata/get_table_list/authorization) | 31 / 31 |
| ✅ | index/Index, index/Ajax, index/User (frontend) | 3 + 10 + 24 = 37 |
| ✅ | cross-cutting/{upload, token, error-envelope, i18n, captcha, rbac, addon-lifecycle} | 53 / 53 |
| ✅ | helpers/__smoke__ | 8 / 8 |
| ⏳ | CLI commands | Tested directly against PHP CLI (TS port not applicable) |

Architecture highlights:

- **Generic `BackendCrudService<T>`** — encapsulates `index/add/edit/del/multi/selectpage`
  with `buildParams` (search/filter/op) translated into TypeORM. 14 admin CRUD
  controllers are thin wrappers around this.
- **`AdminAuthGuard`** — session-based `req.session.admin.id` check; ajax → admin
  envelope code 0, non-ajax → 302 to login.
- **`FrontendAuthGuard`** — cookie `token` → `fa_user_token` → `fa_user`; ajax →
  api envelope code 0, non-ajax → 302 to `/index/user/login`.
- **`AdminLogInterceptor`** — global APP_INTERCEPTOR auto-inserts `fa_admin_log`
  rows on any successful admin POST (skips read-only endpoints).
- **`AdminMultipartErrorFilter`** — catches multer's `BadRequest` on bad multipart
  bodies under `/admin.php/*` and converts to the admin envelope shape.
- **`CsrfService`** — issues 32-hex tokens into `session.__token__`, one-shot
  consumption with constant-time compare. Mismatch returns a fresh
  `__token__` in `data` (matches PHP's Backend::token).
- **`Tree`** helper — port of `fast\Tree::getChildrenIds / getTreeArray /
  getTreeList` with `&nbsp;` + box-drawing indent matching PHP byte-for-byte.
- **Session cookie** named `PHPSESSID` so cross-cutting smoke tests that
  inherited PHP-flavoured cookie assertions pass without modification.
- **Per-rule RBAC** in `AdminAuthGuard` — resolves the request URL into a rule
  name, walks the admin's groups' rules, and denies if the name isn't covered.
  Bypass list mirrors PHP's `$noNeedRight` for index/ajax/util actions.
- **SVG captcha** at `/api/common/captcha` — random 4-char alphanumeric text
  wrapped in inline SVG. Bytes differ per call (test asserts inequality) and
  stored in `session.captcha` for future verification hooks.

How to run tests against the TS port:

```bash
cd ts && PORT=8888 npm start &
cd .. && FASTADMIN_BASE_URL=http://127.0.0.1:8888 SKIP_DB_RESET=1 npx vitest run tests/
# Test Files  40 passed (40)
# Tests       519 passed | 100 skipped (619)
```

## CI

Two GitHub Actions workflows:

- **`.github/workflows/baseline.yml`** — fast path. Runs in CI's native local-mode with
  MySQL/Redis service containers + `shivammathur/setup-php@v2`. Skips Phase-40 CLI tests
  (no docker exec). ~34 files, ~5 minutes.
- **`.github/workflows/baseline-docker.yml`** — full path. Uses docker-compose with the
  same PHP image as local dev. Runs all 40 files including CLI commands. Caches the PHP
  image with GHA cache. ~10 minutes cold, ~3 minutes warm.

Both trigger on push/PR/manual.

## Side-services for tests

| Service | Compose service | Host port | Used by |
|---|---|---|---|
| MySQL 8 | `mysql` | 3787 | All DB-backed tests |
| Redis 7 | `redis` | 6787 | Token driver tests (skipped — Mysql driver default) |
| MailHog | `mailhog` | SMTP 1025, HTTP 8025 | Config emailtest, /api/ems/send mail arrival |
| PHP-S | `php` | 8787 | All HTTP tests |
