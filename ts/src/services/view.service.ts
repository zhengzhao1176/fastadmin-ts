// Minimal view layer. Goal: keep the door open for full twig.js port later,
// but ship a working render() today via tagged template literals.
//
// Templates live under `ts/views/<module>/<path>.html` and are simple HTML
// files with a couple of placeholder tokens:
//   {{ x }}                     — literal substitution of data[x]
//   {{ x|escape }}              — HTML-escaped data[x]
//   {{ x|raw }}                 — raw HTML (used for nested content)
//   {{ x|default('y') }}        — fallback when data[x] is null/undefined
//   {{ __('Key') }}             — i18n placeholder (resolved against the
//                                 per-request lang dict; falls back to the key)
//   {{> partial/name }}         — include another template (same dir tree)
//
// This intentionally avoids implementing loops/conditionals — controllers
// pre-compute everything dynamic before rendering, so templates are just
// substitution + includes. That covers >90% of the FastAdmin admin UI which
// uses templates as DOM skeletons + JS-driven data tables.
import { Injectable, Optional } from '@nestjs/common'
import type { Request, Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { BackendConfigService } from './backend-config.service.ts'
import { I18nService } from './i18n.service.ts'
import { HookService } from './hook.service.ts'

const VIEWS_ROOT = path.resolve(process.cwd(), 'views')

export interface RenderOptions {
  module: 'admin' | 'index'
  template: string             // relative path under views/<module>/, with or without .html
  data: Record<string, unknown>
  layout?: string | false      // default 'layout/default'; false skips wrapping
  /** Explicit language code (zh-cn | en). Overrides cookie/req detection. */
  lang?: string
  /** Used to detect lang from cookie/query when `lang` is not provided. */
  req?: Request
  /** Controller name used to merge controller-specific lang packs into the dict. */
  controllername?: string
}

@Injectable()
export class ViewService {
  private cache = new Map<string, string>()

  constructor(
    @Optional() private readonly backendConfig?: BackendConfigService,
    @Optional() private readonly i18n?: I18nService,
    @Optional() private readonly hooks?: HookService,
  ) {}

  /**
   * Resolve the request language. Mirrors BackendConfigService.detectLanguage's
   * cookie-first preference (think_lang → lang) and falls back to zh-cn. The
   * query string is honoured too so the very first request after switching
   * languages (which sets the cookie via BackendConfigService) sees the new
   * dict immediately rather than only on the next page load.
   */
  private resolveLang(opts: RenderOptions): string {
    if (opts.lang && /^[a-z]{2}(-[a-z]{2})?$/i.test(opts.lang)) {
      return opts.lang.toLowerCase()
    }
    const req = opts.req
    if (!req) return 'zh-cn'
    const query = (req as { query?: Record<string, unknown> }).query ?? {}
    const qLang = typeof query['lang'] === 'string' ? (query['lang'] as string) : ''
    if (qLang && /^[a-z]{2}(-[a-z]{2})?$/i.test(qLang)) {
      const n = qLang.replace('_', '-').toLowerCase()
      return /^[a-z]{2}$/.test(n) ? (n === 'zh' ? 'zh-cn' : n) : n
    }
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {}
    const cookieLang = cookies['think_lang'] ?? cookies['lang']
    if (typeof cookieLang === 'string' && /^[a-z]{2}(-[a-z]{2})?$/i.test(cookieLang)) {
      const n = cookieLang.replace('_', '-').toLowerCase()
      return /^[a-z]{2}$/.test(n) ? (n === 'zh' ? 'zh-cn' : n) : n
    }
    return 'zh-cn'
  }

  /**
   * Build the merged translation dict for (lang, module, controllername).
   * Always merges the shared `__common__` pack first so chrome-level keys
   * (Add/Edit/Delete/Home/Logout/...) are available everywhere.
   */
  private resolveDict(module: 'admin' | 'index', lang: string, controllername?: string): Record<string, string> {
    if (!this.i18n) return {}
    const base = this.i18n.load(lang, module, '__common__')
    if (!controllername) return base
    const more = this.i18n.load(lang, module, controllername)
    return { ...base, ...more }
  }

  /**
   * Build the inline `var require = { config: ... }` JSON for the admin meta
   * partial. Synchronous so the existing render-page shortcuts stay sync. Uses
   * BackendConfigService.buildSync — site fields require BackendConfigService
   * to have been warmed (the admin module does this at bootstrap).
   */
  resolveRequireConfig(req: Request | undefined, controllername?: string, actionname?: string, res?: Response): string {
    if (!this.backendConfig || !req) return '{}'
    const cfg = this.backendConfig.buildSync(req, { controllername, actionname }, res)
    return JSON.stringify(cfg)
  }

  render(opts: RenderOptions): string {
    const lang = this.resolveLang(opts)
    const dict = this.resolveDict(opts.module, lang, opts.controllername)
    const body = this.renderTemplate(opts.module, opts.template, opts.data, dict)
    const layoutName = opts.layout === undefined ? 'layout/default' : opts.layout
    let result: string
    if (layoutName === false) {
      result = body
    } else {
      const layout = this.tryReadTemplate(opts.module, layoutName)
      result = layout
        ? this.substitute(layout, { ...opts.data, __CONTENT__: body }, opts.module, dict)
        : body
    }
    // `view_filter` hook (doc 174) — addons get a last pass over the rendered
    // HTML (inject analytics, rewrite asset URLs, …). Sync filter chain.
    return this.hooks ? this.hooks.filter('view_filter', result) : result
  }

  /** Shortcut: render a generic AdminLTE-styled list page. */
  renderListPage(opts: {
    pageTitle: string
    tableId?: string
    indexUrl: string
    addUrl?: string
    editUrl?: string
    delUrl?: string
    multiUrl?: string
    /** When set, a "Recycle bin" toolbar button is emitted linking here. */
    recyclebinUrl?: string
    /** When set, an "Import" toolbar button (CSV upload → this endpoint) is emitted. */
    importUrl?: string
    /** Upload endpoint the Import button POSTs the chosen file to. Default '/admin.php/ajax/upload'. */
    uploadUrl?: string
    extraScripts?: string
    requireConfig?: string
    req?: Request
    res?: Response
    controllername?: string
    actionname?: string
    /** Column definitions used to emit <thead> + bootstrap-table init JS. */
    columns?: ListColumn[]
    /** sortName default for bootstrap-table init (default 'id'). */
    sortName?: string
    /** pk field for bootstrap-table init (default 'id'). */
    pk?: string
    /**
     * When true, emit an inline bootstrap-table init script (calls
     * `bootstrapTable + Table.api.bindevent`). Default false: the PHP-parity
     * flow has `require-backend.js` auto-load `backend/<name>.js` and run
     * `Controller.index()` which does the init. Inline init on top of that
     * would double-bind every toolbar click handler.
     */
    useInlineInit?: boolean
  }): string {
    const requireConfig = opts.requireConfig ?? this.resolveRequireConfig(opts.req, opts.controllername, opts.actionname, opts.res)
    const tableId = opts.tableId ?? 'table'
    const columns = opts.columns ?? []
    const theadHtml = columns.length ? renderThead(columns) : ''
    // Inline bootstrap-table init.
    //
    // The PHP-parity flow is: `require-backend.js` auto-loads
    // `Config.jsname` (e.g. `backend/category`) and calls
    // `Controller[Config.actionname]()`, which itself runs
    // `Table.api.init(...)` + `bootstrapTable(...)` + `Table.api.bindevent(table)`.
    // If we ALSO emit an inline init, `bindevent` runs twice — every toolbar
    // click handler gets attached twice and a single click on `.btn-add`
    // pops two dialogs.
    //
    // Only emit the inline init when explicitly asked (controllers that lack
    // a backing `public/assets/js/backend/<name>.js`). Default off so the
    // PHP controller JS owns it.
    const tableInitScript = (columns.length && opts.useInlineInit === true)
      ? renderTableInitScript({
          tableId,
          indexUrl: opts.indexUrl,
          addUrl: opts.addUrl,
          editUrl: opts.editUrl,
          delUrl: opts.delUrl,
          multiUrl: opts.multiUrl,
          importUrl: opts.importUrl,
          columns,
          sortName: opts.sortName ?? 'id',
          pk: opts.pk ?? 'id',
        })
      : ''
    // Optional "Recycle bin" / "Import" toolbar buttons. The list-page template
    // can't run conditionals, so the button HTML is pre-rendered here (or left
    // empty). Labels are translated up-front because `|raw` slots are
    // substituted AFTER the `{{ __() }}` pass, so an embedded i18n token in a
    // raw slot would not resolve.
    let recyclebinBtn = ''
    let importBtn = ''
    if (opts.recyclebinUrl || opts.importUrl) {
      const lang = this.resolveLang({ module: 'admin', template: '', data: {}, req: opts.req })
      const dict = this.resolveDict('admin', lang, opts.controllername)
      if (opts.recyclebinUrl) {
        const label = dict['Recycle bin'] ?? 'Recycle bin'
        recyclebinBtn = `<a href="${escapeHtml(opts.recyclebinUrl)}" class="btn btn-info btn-recyclebin" title="${escapeHtml(label)}"><i class="fa fa-recycle"></i> ${escapeHtml(label)}</a>`
      }
      if (opts.importUrl) {
        const label = dict['Import'] ?? 'Import'
        const uploadUrl = opts.uploadUrl ?? '/admin.php/ajax/upload'
        // `.btn-import` is wired by Table.api.bindevent → Upload.api.upload:
        // it opens a file picker, uploads the chosen .csv to `data-url`, then
        // POSTs {file: <url>} to the table's `extend.import_url`.
        importBtn = `<a href="javascript:;" class="btn btn-info btn-import" title="${escapeHtml(label)}" data-url="${escapeHtml(uploadUrl)}" data-mimetype="csv" data-multiple="false"><i class="fa fa-upload"></i> ${escapeHtml(label)}</a>`
      }
    }
    return this.render({
      module: 'admin',
      template: '_partials/list-page',
      data: { ...opts, tableId, theadHtml, tableInitScript, recyclebinBtn, importBtn, requireConfig },
      req: opts.req,
      controllername: opts.controllername,
    })
  }

  /**
   * Shortcut: render the Recycle Bin list page. Mirrors `renderListPage` but
   * targets `_partials/recyclebin-page` and emits an init script whose operate
   * column carries per-row Restore / Destroy buttons. The `.btn-restoreall` /
   * `.btn-destroyall` toolbar buttons are wired by `Table.api.bindevent`.
   */
  renderRecyclebinPage(opts: {
    pageTitle: string
    tableId?: string
    /** AJAX endpoint that returns `{total, rows}` of soft-deleted rows. */
    recyclebinUrl: string
    /** Endpoint that clears `deletetime` (restore). */
    restoreUrl: string
    /** Endpoint that hard-deletes a binned row (destroy). */
    destroyUrl: string
    requireConfig?: string
    req?: Request
    res?: Response
    controllername?: string
    actionname?: string
    columns?: ListColumn[]
    sortName?: string
    pk?: string
  }): string {
    const requireConfig = opts.requireConfig
      ?? this.resolveRequireConfig(opts.req, opts.controllername, opts.actionname ?? 'recyclebin', opts.res)
    const tableId = opts.tableId ?? 'table'
    const columns = opts.columns ?? []
    const theadHtml = columns.length ? renderThead(columns) : ''
    const recyclebinInitScript = columns.length
      ? renderRecyclebinInitScript({
          tableId,
          recyclebinUrl: opts.recyclebinUrl,
          restoreUrl: opts.restoreUrl,
          destroyUrl: opts.destroyUrl,
          columns,
          sortName: opts.sortName ?? 'id',
          pk: opts.pk ?? 'id',
        })
      : ''
    return this.render({
      module: 'admin',
      template: '_partials/recyclebin-page',
      data: { ...opts, tableId, theadHtml, recyclebinInitScript, requireConfig },
      req: opts.req,
      controllername: opts.controllername,
    })
  }

  /** Shortcut: render a generic form page (used by add / edit). */
  renderFormPage(opts: {
    pageTitle?: string
    formId?: string
    formAction: string
    __token__: string
    fields: string
    idsField?: string
    /** Inline `<script>` block appended after the form (used for Form.api.bindevent). */
    extraScripts?: string
    requireConfig?: string
    req?: Request
    res?: Response
    controllername?: string
    actionname?: string
    /**
     * When true, emit an inline `Form.api.bindevent($("form#<id>"))` script.
     * Default false: the PHP-parity flow has `require-backend.js` auto-load
     * `backend/<name>.js` and run `Controller.<action>()` which itself calls
     * `Form.api.bindevent` on the form. Inline binding on top of that
     * double-wires every form event (submit + load-success). The form
     * submission then races with itself and the layer dialog never closes.
     */
    useInlineBind?: boolean
  }): string {
    const requireConfig = opts.requireConfig ?? this.resolveRequireConfig(opts.req, opts.controllername, opts.actionname, opts.res)
    const formId = opts.formId ?? 'add-form'
    const extraScripts = opts.extraScripts ?? (opts.useInlineBind === true ? buildFormBindScript(formId) : '')
    return this.render({
      module: 'admin',
      template: '_partials/form-page',
      data: {
        ...opts,
        formId,
        idsField: opts.idsField ?? '',
        extraScripts,
        requireConfig,
      },
      req: opts.req,
      controllername: opts.controllername,
    })
  }

  /** Shortcut: render a generic detail page with a free-form body block. */
  renderDetailPage(opts: {
    pageTitle?: string
    body: string
    requireConfig?: string
    req?: Request
    res?: Response
    controllername?: string
    actionname?: string
  }): string {
    const requireConfig = opts.requireConfig ?? this.resolveRequireConfig(opts.req, opts.controllername, opts.actionname, opts.res)
    return this.render({
      module: 'admin',
      template: '_partials/detail-page',
      data: { ...opts, body: opts.body, requireConfig },
      req: opts.req,
      controllername: opts.controllername,
    })
  }

  private renderTemplate(module: 'admin' | 'index', tpl: string, data: Record<string, unknown>, dict: Record<string, string>): string {
    const raw = this.readTemplate(module, tpl)
    return this.substitute(raw, data, module, dict)
  }

  private substitute(tpl: string, data: Record<string, unknown>, module: 'admin' | 'index', dict: Record<string, string>): string {
    // {{> partial/name }} — recursive include.
    tpl = tpl.replace(/\{\{>\s*([^\s}]+)\s*\}\}/g, (_, p: string) => this.renderTemplate(module, p, data, dict))

    // {{ __CONTENT__|raw }} or {{ __CONTENT__ }} — special slot (always raw).
    tpl = tpl.replace(/\{\{\s*__CONTENT__(?:\|raw)?\s*\}\}/g, () => String(data.__CONTENT__ ?? ''))

    // {{ __('Key') }} / {{ __('Hi %s', 'name') }} — i18n placeholder. Looks up
    // `Key` in the per-request merged dict (falls back to the key — PHP __()
    // parity), then sprintf-substitutes any extra `%s` / `%d` args. Mirrors
    // FastAdmin's `__('My name is %s', "FastAdmin")` documented behaviour.
    tpl = tpl.replace(
      /\{\{\s*__\(\s*(['"])(.+?)\1\s*((?:,\s*(?:'[^']*'|"[^"]*"|[\d.]+)\s*)*)\)\s*\}\}/g,
      (_, _q, key: string, argsRaw: string) => {
        const translated = dict[key] ?? key
        const args = parseI18nArgs(argsRaw)
        return args.length > 0 ? formatPlaceholders(translated, args) : translated
      },
    )

    // {{ x|escape }} / {{ x|raw }} / {{ x|default('y') }} / {{ x }}
    tpl = tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)(?:\|([a-zA-Z]+)(?:\(([^)]*)\))?)?\s*\}\}/g, (_, key: string, filter?: string, arg?: string) => {
      const v = this.lookup(data, key)
      if (filter === 'raw') return String(v ?? '')
      if (filter === 'default') {
        if (v == null || v === '') {
          const def = (arg ?? '').replace(/^['"]|['"]$/g, '')
          return escapeHtml(def)
        }
        return escapeHtml(String(v))
      }
      if (filter === 'escape' || !filter) return escapeHtml(String(v ?? ''))
      return escapeHtml(String(v ?? ''))
    })

    return tpl
  }

  private lookup(data: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.')
    let cur: unknown = data
    for (const p of parts) {
      if (cur == null) return undefined
      cur = (cur as Record<string, unknown>)[p]
    }
    return cur
  }

  private readTemplate(module: 'admin' | 'index', tpl: string): string {
    const found = this.tryReadTemplate(module, tpl)
    if (!found) throw new Error(`Template not found: ${module}/${tpl}`)
    return found
  }

  private tryReadTemplate(module: 'admin' | 'index', tpl: string): string | null {
    const rel = tpl.endsWith('.html') ? tpl : tpl + '.html'
    const key = `${module}/${rel}`
    if (this.cache.has(key)) return this.cache.get(key)!
    const abs = path.join(VIEWS_ROOT, module, rel)
    if (!fs.existsSync(abs)) return null
    const text = fs.readFileSync(abs, 'utf8')
    this.cache.set(key, text)
    return text
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Parse the extra-args portion of a `{{ __('key', 'a', 2) }}` call — the
 * `, 'a', 2` tail — into a string[]. Quoted strings keep their content,
 * bare numbers pass through verbatim.
 */
function parseI18nArgs(raw: string): string[] {
  if (!raw || !raw.trim()) return []
  const out: string[] = []
  const re = /'([^']*)'|"([^"]*)"|([\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

/**
 * sprintf-lite — substitute `%s` / `%d` placeholders left-to-right. Mirrors
 * FastAdmin's `__()` which forwards extra args into PHP `sprintf`. Surplus
 * placeholders are left intact; surplus args are ignored.
 */
function formatPlaceholders(template: string, args: string[]): string {
  let i = 0
  return template.replace(/%[sd]/g, (token) => {
    if (i >= args.length) return token
    const a = args[i++]!
    return token === '%d' ? String(parseInt(a, 10) || 0) : a
  })
}

/**
 * Inline `<script>` that wires `Form.api.bindevent` to a form on the page.
 * `Form.api.bindevent` is FastAdmin's AJAX form submit handler — it intercepts
 * the form submit, posts via XHR, shows a toast on success, and (when in a
 * layer dialog) closes the parent layer and reloads the parent's table. Without
 * this script the submit triggers a full page navigation that lands the raw
 * JSON envelope back in the iframe.
 */
export function buildFormBindScript(formId: string): string {
  // See `buildTableInitScript` comment — the script renders before the
  // require.js loader tag, so wait until both `require` and `$` exist.
  return `\n<script type="text/javascript">\n(function bootForm() {\n  if (typeof require === 'undefined' || typeof $ === 'undefined') {\n    return setTimeout(bootForm, 30);\n  }\n  require(['form'], function (Form) {\n    Form.api.bindevent($("form#${formId}"));\n  });\n})();\n</script>\n`
}

/**
 * Column definition for bootstrap-table-driven list pages.
 * Mirrors the PHP convention in `application/admin/view/<module>/index.html` +
 * `public/assets/js/backend/<module>.js` columns: array. Each entry becomes
 * one <th data-field="..."> in the rendered <thead> and one column entry in
 * the inline bootstrapTable() init call.
 */
export interface ListColumn {
  /** field name on the row (omit for checkbox or operate). */
  field?: string
  /** column heading text. */
  title?: string
  /** true → emit a checkbox column at this position. */
  checkbox?: boolean
  /** true → emit the operate (edit/del) column at this position. */
  operate?: boolean
  /** sortable flag forwarded to bootstrap-table. */
  sortable?: boolean
  /** Table.api.formatter.<name> — picked up from window.Table inside init JS. */
  formatter?: string
  /** Width attribute (e.g. '100px' or '10%'). */
  width?: string
  /** Visible column? Defaults to true; omit / leave undefined. */
  visible?: boolean
}

/** Build <thead><tr> with one <th data-field="…"> per column. */
function renderThead(columns: ListColumn[]): string {
  const cells = columns.map((c) => {
    if (c.checkbox) return '<th data-field="state" data-checkbox="true"></th>'
    if (c.operate) {
      return `<th data-field="operate" data-formatter="${escapeHtml(c.formatter ?? 'Table.api.formatter.operate')}">${escapeHtml(c.title ?? 'Operate')}</th>`
    }
    const attrs: string[] = []
    attrs.push(`data-field="${escapeHtml(c.field ?? '')}"`)
    if (c.sortable) attrs.push('data-sortable="true"')
    if (c.width) attrs.push(`data-width="${escapeHtml(c.width)}"`)
    if (c.formatter) attrs.push(`data-formatter="${escapeHtml(c.formatter)}"`)
    if (c.visible === false) attrs.push('data-visible="false"')
    return `<th ${attrs.join(' ')}>${escapeHtml(c.title ?? c.field ?? '')}</th>`
  })
  return `\n<thead><tr>\n  ${cells.join('\n  ')}\n</tr></thead>`
}

/** Emit the inline require(['table'], …) bootstrapTable initialiser. */
function renderTableInitScript(opts: {
  tableId: string
  indexUrl: string
  addUrl?: string
  editUrl?: string
  delUrl?: string
  multiUrl?: string
  importUrl?: string
  columns: ListColumn[]
  sortName: string
  pk: string
}): string {
  const cols = opts.columns.map((c) => {
    if (c.checkbox) return '{checkbox: true}'
    if (c.operate) {
      return `{field: 'operate', title: __('Operate'), table: table, events: Table.api.events.operate, formatter: Table.api.formatter.operate}`
    }
    const parts: string[] = []
    parts.push(`field: ${JSON.stringify(c.field ?? '')}`)
    parts.push(`title: __(${JSON.stringify(c.title ?? c.field ?? '')})`)
    if (c.sortable) parts.push('sortable: true')
    if (c.formatter) parts.push(`formatter: ${c.formatter}`)
    if (c.visible === false) parts.push('visible: false')
    return `{${parts.join(', ')}}`
  })
  // The init script renders inline inside the content section, which the
  // template engine emits BEFORE the bottom `<script src="require.js">` tag
  // (the layout puts the require loader in `common/script`). At parse time
  // `require` is undefined and the call throws `require is not a function`.
  // Wait for `require` to be available by polling on a short interval (it
  // appears as soon as require.js parses, which is right after this script).
  // The Table.defaults from require-table.js are only applied when
  // Table.api.init() is called (typically by backend-init). Inline tables
  // initialised before that lose `sidePagination: 'server'` (makes BST treat
  // the {total, rows} envelope as a raw array and render zero rows), and
  // also the `extend.{add,edit,del,multi,dragsort}_url` block that the
  // operate-column formatter dereferences at row-render time. Spell them all
  // out here so a table that initialises pre-init still works.
  const indexUrl = opts.indexUrl ?? ''
  const addUrl = opts.addUrl ?? ''
  const editUrl = opts.editUrl ?? ''
  const delUrl = opts.delUrl ?? ''
  const multiUrl = opts.multiUrl ?? ''
  const importUrl = opts.importUrl ?? ''
  const initBody = `var table = $("#${opts.tableId}");\n  table.bootstrapTable({\n    url: ${JSON.stringify(indexUrl)},\n    pk: ${JSON.stringify(opts.pk)},\n    sortName: ${JSON.stringify(opts.sortName)},\n    sidePagination: 'server',\n    method: 'get',\n    pagination: true,\n    pageSize: 10,\n    pageList: [10, 15, 20, 25, 50, 'All'],\n    showToggle: false,\n    showColumns: false,\n    search: true,\n    toolbar: '.toolbar',\n    extend: {\n      index_url: ${JSON.stringify(indexUrl)},\n      add_url: ${JSON.stringify(addUrl)},\n      edit_url: ${JSON.stringify(editUrl)},\n      del_url: ${JSON.stringify(delUrl)},\n      multi_url: ${JSON.stringify(multiUrl)},\n      import_url: ${JSON.stringify(importUrl)},\n      dragsort_url: ''\n    },\n    columns: [[\n      ${cols.join(',\n      ')}\n    ]]\n  });\n  Table.api.bindevent(table);`
  return `\n<script type="text/javascript">\n(function bootTable() {\n  if (typeof require === 'undefined' || typeof $ === 'undefined') {\n    return setTimeout(bootTable, 30);\n  }\n  require(['table'], function (Table) {\n  ${initBody}\n});\n})();\n</script>\n`
}

/**
 * Emit the inline bootstrapTable initialiser for the Recycle Bin page.
 *
 * Differs from `renderTableInitScript` in the operate column: instead of
 * edit/del buttons it carries per-row Restore / Destroy buttons. Those use the
 * generic `.btn-ajax` handler (from backend.js) which honours `data-confirm`
 * and `data-refresh`. Each button URL keeps an explicit `?ids={ids}` so
 * `Table.api.replaceurl` substitutes the row pk in place — that lets a single
 * `@All('restore')` / `@All('destroy')` route serve both the per-row buttons
 * and the no-id `.btn-restoreall` / `.btn-destroyall` toolbar buttons (the
 * latter wired by `Table.api.bindevent` straight off the button `data-url`).
 */
function renderRecyclebinInitScript(opts: {
  tableId: string
  recyclebinUrl: string
  restoreUrl: string
  destroyUrl: string
  columns: ListColumn[]
  sortName: string
  pk: string
}): string {
  const cols = opts.columns.map((c) => {
    if (c.checkbox) return '{checkbox: true}'
    if (c.operate) {
      const restoreBtn = `{name: 'Restore', text: __('Restore'), title: __('Restore'), classname: 'btn btn-xs btn-info btn-ajax', icon: 'fa fa-rotate-left', url: ${JSON.stringify(opts.restoreUrl + '?ids={ids}')}, refresh: true}`
      const destroyBtn = `{name: 'Destroy', text: __('Destroy'), title: __('Destroy'), classname: 'btn btn-xs btn-danger btn-ajax', icon: 'fa fa-times', url: ${JSON.stringify(opts.destroyUrl + '?ids={ids}')}, confirm: __('Are you sure you want to delete the selected item?'), refresh: true}`
      return `{field: 'operate', title: __('Operate'), table: table, events: Table.api.events.operate, buttons: [${restoreBtn}, ${destroyBtn}], formatter: Table.api.formatter.operate}`
    }
    const parts: string[] = []
    parts.push(`field: ${JSON.stringify(c.field ?? '')}`)
    parts.push(`title: __(${JSON.stringify(c.title ?? c.field ?? '')})`)
    if (c.sortable) parts.push('sortable: true')
    if (c.formatter) parts.push(`formatter: ${c.formatter}`)
    if (c.visible === false) parts.push('visible: false')
    return `{${parts.join(', ')}}`
  })
  const initBody = `var table = $("#${opts.tableId}");\n  table.bootstrapTable({\n    url: ${JSON.stringify(opts.recyclebinUrl)},\n    pk: ${JSON.stringify(opts.pk)},\n    sortName: ${JSON.stringify(opts.sortName)},\n    sidePagination: 'server',\n    method: 'get',\n    pagination: true,\n    pageSize: 10,\n    pageList: [10, 15, 20, 25, 50, 'All'],\n    showToggle: false,\n    showColumns: false,\n    search: true,\n    toolbar: '.toolbar',\n    extend: {\n      index_url: '',\n      add_url: '',\n      edit_url: '',\n      del_url: '',\n      multi_url: '',\n      import_url: '',\n      dragsort_url: '',\n      restore_url: ${JSON.stringify(opts.restoreUrl)},\n      destroy_url: ${JSON.stringify(opts.destroyUrl)}\n    },\n    columns: [[\n      ${cols.join(',\n      ')}\n    ]]\n  });\n  Table.api.bindevent(table);`
  return `\n<script type="text/javascript">\n(function bootRecyclebin() {\n  if (typeof require === 'undefined' || typeof $ === 'undefined') {\n    return setTimeout(bootRecyclebin, 30);\n  }\n  require(['table'], function (Table) {\n  ${initBody}\n});\n})();\n</script>\n`
}
