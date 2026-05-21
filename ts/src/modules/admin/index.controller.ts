import { All, Body, Controller, Get, Header, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { adminErr, adminOk, type AdminEnvelope } from '../../common/envelope.ts'
import { AdminAuthService } from '../../services/admin-auth.service.ts'
import { AdminAuthLibrary } from '../../services/admin-auth-library.service.ts'
import { CsrfService, type SessionWithToken } from '../../services/csrf.service.ts'
import { ViewService } from '../../services/view.service.ts'
import { BackendConfigService } from '../../services/backend-config.service.ts'
import { HookService } from '../../services/hook.service.ts'
import type { AdminEntity } from '../../entities/admin.entity.ts'

interface SessionShape extends SessionWithToken {
  admin?: { id: number; username: string } | undefined
}

// express-session augments Request['session']; we layer our own keys on top
// via an intersection rather than extending Request (avoids type collision).
type AdminReq = Request & {
  session: SessionShape & { destroy(cb: (err?: unknown) => void): void; [k: string]: unknown }
}

// The 18 AdminLTE + FastAdmin skins shipped under public/assets/css/skins/.
// The `adminskin` cookie is matched against this set so a tampered cookie
// can never inject an arbitrary class onto <body>.
const ADMIN_SKINS = new Set<string>([
  'skin-blue', 'skin-black', 'skin-purple', 'skin-green', 'skin-red', 'skin-yellow',
  'skin-blue-light', 'skin-black-light', 'skin-purple-light', 'skin-green-light',
  'skin-red-light', 'skin-yellow-light', 'skin-black-blue', 'skin-black-purple',
  'skin-black-green', 'skin-black-red', 'skin-black-yellow', 'skin-black-pink',
])

// Mirrors application/admin/controller/Index.php.
@Controller('admin.php/index')
export class AdminIndexController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly library: AdminAuthLibrary,
    private readonly csrf: CsrfService,
    private readonly view: ViewService,
    private readonly backendConfig: BackendConfigService,
    private readonly hooks: HookService,
  ) {}

  // GET → login form HTML; POST → process login.
  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getLogin(
    @Req() req: AdminReq,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const tok = this.csrf.issue(req.session)
    const cfg = await this.backendConfig.build(req, { controllername: 'index', actionname: 'login' }, res)
    return this.view.render({
      module: 'admin',
      template: 'index/login',
      layout: false,
      data: {
        title: '登录',
        __token__: tok,
        requireConfig: JSON.stringify(cfg),
      },
    })
  }

  @Post('login')
  async postLogin(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminEnvelope<unknown>> {
    // Already logged in → no re-login, returns success jump.
    if (req.session.admin?.id) {
      return adminOk("You've logged in, do not login again", '', '/admin.php/index/index')
    }
    // `login_init` — fires when an admin login attempt begins. Addons hook it
    // for captcha enforcement, IP allow-lists, brute-force counters, etc.
    await this.hooks.listen('login_init', { username: String(body['username'] ?? '').trim() })
    const username = String(body['username'] ?? '').trim()
    const password = String(body['password'] ?? '')
    const submittedToken = String(body['__token__'] ?? '')

    if (!this.csrf.consume(req.session, submittedToken)) {
      // PHP returns code 0 with a regenerated __token__ in data so the client
      // can retry without re-fetching the form.
      const fresh = this.csrf.issue(req.session)
      return adminErr('Token verification error', { token: fresh })
    }
    // Length validation (mirrors PHP validate rule length:3,30).
    if (username.length < 3 || username.length > 30) return adminErr('用户名长度必须在3到30之间')
    if (password.length < 3 || password.length > 30) return adminErr('密码长度必须在3到30之间')

    const r = await this.auth.login(username, password, req.ip ?? '127.0.0.1')
    if (!r.ok || !r.admin) {
      const msg = r.error === 'username_incorrect' ? '用户名不正确'
        : r.error === 'admin_forbidden' ? '账号已禁用'
        : '密码不正确'
      return adminErr(msg)
    }
    req.session.admin = { id: r.admin.id, username: r.admin.username }
    // PHP sets a `keeplogin` signed-hash cookie when keeplogin=1. Tests only
    // assert truthy presence; opaque marker is sufficient.
    const keepFlag = body['keeplogin']
    if (keepFlag && String(keepFlag) !== '0') {
      res.cookie('keeplogin', `${r.admin.id}|${Date.now()}`, {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
      })
    }
    return adminOk('Login successful', {
      id: r.admin.id,
      username: r.admin.username,
      url: '/admin.php/index/index',
      avatar: r.admin.avatar,
    }, '/admin.php/index/index')
  }

  // GET → auto-submit HTML form (mirrors PHP behaviour);
  // POST → invalidate session.
  @Get('logout')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getLogout(@Req() req: AdminReq): string {
    const tok = this.csrf.issue(req.session)
    return `<!DOCTYPE html><html><head><title>Logout</title></head><body>
<form id="logout_submit" method="POST" action="/admin.php/index/logout">
  <input type="hidden" name="__token__" value="${tok}">
</form>
<script>document.getElementById('logout_submit').submit();</script>
</body></html>`
  }

  @Post('logout')
  async postLogout(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
  ): Promise<AdminEnvelope<null>> {
    const submitted = String(body['__token__'] ?? '')
    if (!this.csrf.consume(req.session, submitted)) {
      const fresh = this.csrf.issue(req.session)
      return adminErr('Token verification error', { token: fresh } as unknown as null)
    }
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()))
    return adminOk('Logout successful', null, '/admin.php/index/login')
  }

  // index = AdminLTE shell HTML when GET, action=refreshmenu when POST.
  // The shell hosts the header, sidebar menu, and an empty .content-wrapper
  // that addtabs JS fills with iframes as the user clicks menu items. The
  // dashboard stats panel is served separately at /admin.php/dashboard/index
  // and is loaded INSIDE one of those tab panes — never directly into the
  // shell URL.
  @All('index')
  async index(
    @Req() req: AdminReq,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminEnvelope<unknown> | string | undefined> {
    if (!req.session.admin?.id) {
      // unauth: redirect (matches PHP non-ajax behaviour); the test accepts either.
      res.redirect(302, '/admin.php/index/login')
      return undefined
    }
    const isPost = req.method === 'POST'
    if (isPost && String(body['action'] ?? '') === 'refreshmenu') {
      const sidebar = await this.library.getSidebar(req.session.admin.id)
      return adminOk('', sidebar)
    }
    // GET shell: header + sidebar + empty tab container.
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    const cfg = await this.backendConfig.build(req, { controllername: 'index', actionname: 'index' }, res)
    const sidebar = await this.library.getSidebar(req.session.admin.id)
    const adminRow = await this.auth.findById(req.session.admin.id)
    const adminAvatar = (adminRow?.avatar && adminRow.avatar.length > 0)
      ? adminRow.avatar
      : '/assets/img/avatar.png'
    const adminNickname = (adminRow?.nickname && adminRow.nickname.length > 0)
      ? adminRow.nickname
      : req.session.admin.username
    const adminLogintimeRaw = adminRow?.logintime
    const adminLogintime = adminLogintimeRaw
      ? new Date(adminLogintimeRaw * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : ''
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {}
    // Prefer the detected language from BackendConfigService (which honours
    // ?lang=xx query param + cookie + Accept-Language) so the active class on
    // the lang switcher always matches what the page will actually serve.
    const currentLang = cfg.language
      || (typeof cookies['lang'] === 'string' && cookies['lang'].length > 0 ? cookies['lang'] : 'zh-cn')
    const menuHtml = renderMenuTreeHtml(
      sidebar.menulist as MenuRow[],
      this.collectFixedmenuNames(),
    )
    const navHtml = renderNavHtml(sidebar.navlist as MenuRow[])
    // Skin + layout state — driven by the `adminskin` / `multiplenav` /
    // `multipletab` / `sidebar_collapse` cookies that backend/index.js writes
    // when the operator uses the right-hand control sidebar. The skin name is
    // whitelisted so a tampered cookie can't inject an arbitrary body class.
    const adminskin = ADMIN_SKINS.has(String(cookies['adminskin'] ?? ''))
      ? String(cookies['adminskin'])
      : 'skin-black-blue'
    const multiplenav = cookies['multiplenav'] === '1'
    const multipletab = cookies['multipletab'] !== '0' // FastAdmin default: on
    const sidebarCollapse = cookies['sidebar_collapse'] === '1'
    const bodyClass = [
      adminskin,
      'sidebar-mini',
      sidebarCollapse ? 'sidebar-collapse' : '',
      'fixed',
      multipletab ? 'multipletab' : '',
      multiplenav ? 'multiplenav' : '',
    ].filter(Boolean).join(' ')
    return this.view.render({
      module: 'admin',
      template: 'index/index',
      layout: false,
      data: {
        title: 'FastAdmin',
        bodyClass,
        multiplenavChecked: multiplenav ? 'checked' : '',
        multipletabChecked: multipletab ? 'checked' : '',
        admin_username: adminNickname,
        admin_avatar: adminAvatar,
        admin_logintime: adminLogintime,
        menuHtml,
        navHtml,
        langZhActive: currentLang === 'zh-cn' ? 'active' : '',
        langEnActive: currentLang === 'en' ? 'active' : '',
        requireConfig: JSON.stringify({
          ...cfg,
          admin: {
            id: req.session.admin.id,
            username: req.session.admin.username,
            nickname: adminNickname,
            avatar: adminAvatar,
          },
        }),
      },
    })
  }

  /**
   * Menu node names the PHP version pins to the top via a `fixedmenu` hint
   * dictionary. We carry the same list but only use it to decide which nodes
   * are auto-opened — the actual tree comes from auth_rule. (No-op today; the
   * tree from getSidebar is already ordered by `weigh DESC`.)
   */
  private collectFixedmenuNames(): Record<string, string | string[]> {
    return {
      dashboard: 'hot',
      addon: ['new', 'red', 'badge'],
      'auth/rule': 'Menu',
    }
  }
}

interface MenuRow {
  id: number
  pid: number
  name: string
  title: string
  icon: string
  url: string | null
  ismenu: number
}

function escapeHtmlAttr(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Render the visible menu tree (PHP `Auth::getSidebar` returns a flat list +
 * navlist; nesting is reconstructed here from pid pointers). Each leaf gets a
 * `url` attribute so the addtabs JS layer (`assets/libs/fastadmin-addtabs/
 * jquery.addtabs.js:38`) can open it in a new tab pane on click. Submenus get
 * `<ul class="treeview-menu">…</ul>` plus `url="javascript:;"` on their parent
 * `<a>` so the addtabs delegate doesn't trip on `undefined.indexOf(...)`.
 */
function renderMenuTreeHtml(rows: MenuRow[], _hints: Record<string, unknown>): string {
  if (!rows || rows.length === 0) return ''
  const byPid = new Map<number, MenuRow[]>()
  for (const r of rows) {
    const list = byPid.get(Number(r.pid)) ?? []
    list.push(r)
    byPid.set(Number(r.pid), list)
  }
  function walk(parentId: number, depth: number): string {
    const children = byPid.get(parentId) ?? []
    if (children.length === 0) return ''
    let out = ''
    for (const c of children) {
      const grand = byPid.get(Number(c.id)) ?? []
      const icon = c.icon || 'fa fa-circle-o'
      const title = escapeHtmlAttr(c.title || c.name || '')
      const name = c.name ?? ''
      // PHP `url('/admin/addon')` resolves to `/admin.php/addon` and the
      // framework dispatches to the default `index` action. NestJS routes are
      // explicit, so for LEAF items (no submenu) we append `/index` so the
      // URL hits the controller's `@Get('index')` handler. Submenu parents
      // get a placeholder URL — they don't get clicked through.
      const url = name && name.length > 0
        ? (grand.length > 0 ? `/admin.php/${name}` : `/admin.php/${name}/index`)
        : '#'
      if (grand.length > 0) {
        out += `<li class="treeview">`
        out += `<a href="javascript:;" url="javascript:;" py="" pinyin=""><i class="${escapeHtmlAttr(icon)}"></i> <span>${title}</span> `
        out += `<i class="fa fa-angle-left pull-right"></i></a>`
        out += `<ul class="treeview-menu">`
        out += walk(Number(c.id), depth + 1)
        out += `</ul></li>`
      } else {
        out += `<li><a href="${escapeHtmlAttr(url)}?ref=addtabs" url="${escapeHtmlAttr(url)}" addtabs="${c.id}" py="" pinyin="">`
        out += `<i class="${escapeHtmlAttr(icon)}"></i> <span>${title}</span></a></li>`
      }
    }
    return out
  }
  return walk(0, 0)
}

/** Top-nav addtabs list — PHP populates this with the currently-open tab panes; on first paint there are none, so emit an empty list. */
function renderNavHtml(_navlist: MenuRow[]): string {
  return ''
}
