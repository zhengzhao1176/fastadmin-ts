// Port of `fast\Form` from extend/fast/Form.php — server-side form-control
// HTML builders. PHP's class has dozens of widget methods; this covers the
// core set used in views: input/text, select, textarea, checkbox, radios
// and the CSRF token field. Output mirrors PHP's markup (e.g. the
// `form-control` class injection and `htmlspecialchars` escaping).

/** HTML attribute bag. `true` renders a bare attribute (key="key"); an object
 *  value is JSON-encoded (PHP's Form does this for `data-*` array attrs). */
export type Attrs = Record<string, string | number | boolean | null | undefined | object>

/** Escape a value for safe placement inside HTML (ENT_QUOTES equivalent). */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Render an attribute bag to a string with a leading space (or ''). */
function attributes(attrs: Attrs): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue
    // `true` → bare attribute, matching PHP's numeric-key behaviour.
    if (value === true) {
      parts.push(`${key}="${key}"`)
      continue
    }
    // Object attr values → JSON (PHP encodes array `data-*` attrs this way).
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
    // Single-quote the value if it contains a double quote.
    if (str.includes('"')) parts.push(`${key}='${str}'`)
    else parts.push(`${key}="${str}"`)
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

/** Merge a `form-control` class in unless one is already present. */
function withFormControl(attrs: Attrs): Attrs {
  const cls = attrs.class
  if (typeof cls === 'string') {
    return cls.toLowerCase().includes('form-control')
      ? attrs
      : { ...attrs, class: `${cls} form-control` }
  }
  return { ...attrs, class: 'form-control' }
}

/** Value types that should not receive a `value` / `form-control`. */
const SKIP_VALUE_TYPES = new Set(['file', 'password', 'checkbox', 'radio'])

/**
 * Generate an `<input>`. `type` defaults to `text`.
 *
 *   input('x', 'v') // <input class="form-control" type="text" name="x" value="v">
 */
export function input(
  name: string,
  value: string | null = null,
  attrs: Attrs = {},
  type = 'text',
): string {
  let merged: Attrs = { ...attrs, name: attrs.name ?? name, type }
  if (!SKIP_VALUE_TYPES.has(type)) {
    merged = withFormControl(merged)
    if (value != null) merged.value = escape(value)
  } else if (value != null) {
    merged.value = escape(value)
  }
  return `<input${attributes(merged)}>`
}

/** Generate a `<textarea>`. Defaults to cols=50 rows=5 like PHP. */
export function textarea(
  name: string,
  value = '',
  attrs: Attrs = {},
): string {
  const merged = withFormControl({
    name: attrs.name ?? name,
    cols: attrs.cols ?? 50,
    rows: attrs.rows ?? 5,
    ...attrs,
  })
  return `<textarea${attributes(merged)}>${escape(value)}</textarea>`
}

/** A single `<option>`, marked selected when its value matches. */
function option(
  display: string,
  value: string,
  selected: string | string[] | null,
): string {
  const isSel = Array.isArray(selected)
    ? selected.map(String).includes(String(value))
    : String(value) === String(selected)
  return `<option${attributes({ value: escape(value), selected: isSel })}>${escape(display)}</option>`
}

/**
 * Generate a `<select>`. `options` maps option value → display label.
 *
 *   select('s', { 1: 'One', 2: 'Two' }, '2')
 */
export function select(
  name: string,
  options: Record<string, string>,
  selected: string | string[] | null = null,
  attrs: Attrs = {},
): string {
  const merged = withFormControl({ name: attrs.name ?? name, ...attrs })
  const opts = Object.entries(options)
    .map(([value, display]) => option(display, value, selected))
    .join('')
  return `<select${attributes(merged)}>${opts}</select>`
}

/**
 * Generate a single checkbox `<input>`. `value` is the submitted value
 * (default `'1'`); pass `checked` to pre-check it.
 */
export function checkbox(
  name: string,
  value = '1',
  checked = false,
  attrs: Attrs = {},
): string {
  const merged: Attrs = { ...attrs }
  if (checked) merged.checked = 'checked'
  return input(name, value, merged, 'checkbox')
}

/** Generate a single radio `<input>`. */
export function radio(
  name: string,
  value: string,
  checked = false,
  attrs: Attrs = {},
): string {
  const merged: Attrs = { ...attrs }
  if (checked) merged.checked = 'checked'
  return input(name, value, merged, 'radio')
}

/**
 * Generate a group of radios wrapped in a `<div class="radio">`.
 * `options` maps value → label; `checked` selects one (defaults to first).
 */
export function radios(
  name: string,
  options: Record<string, string>,
  checked: string | null = null,
  attrs: Attrs = {},
): string {
  const keys = Object.keys(options)
  const sel = checked ?? keys[0]
  const items = keys.map((k) => {
    const id = `${name}-${k}`
    const r = radio(name, k, String(k) === String(sel), { ...attrs, id })
    return `<label for="${id}">${r} ${escape(options[k])}</label>`
  })
  return `<div class="radio">${items.join(' ')}</div>`
}

/**
 * Generate a group of checkboxes wrapped in a `<div class="checkbox">`.
 * `checked` is the set of pre-checked values.
 */
export function checkboxs(
  name: string,
  options: Record<string, string>,
  checked: string[] = [],
  attrs: Attrs = {},
): string {
  const checkedSet = new Set(checked.map(String))
  const items = Object.keys(options).map((k) => {
    const id = `${name}-${k}`
    const c = checkbox(`${name}[${k}]`, k, checkedSet.has(String(k)), {
      ...attrs,
      id,
    })
    return `<label for="${id}">${c} ${escape(options[k])}</label>`
  })
  return `<div class="checkbox">${items.join(' ')}</div>`
}

/**
 * Generate a hidden CSRF token field. PHP uses a `__token__` field; the
 * caller supplies the token value (the framework normally provides one).
 */
export function token(value: string, name = '__token__'): string {
  return input(name, value, {}, 'hidden')
}

// ---------------------------------------------------------------------------
// Extended `\fast\Form` widgets (doc 1264). All pure HTML-string builders.
// ---------------------------------------------------------------------------

/** Append a class to an attr bag (FastAdmin's class-merge convention). */
function withClass(attrs: Attrs, cls: string): Attrs {
  const cur = typeof attrs.class === 'string' ? attrs.class : ''
  return { ...attrs, class: cur ? `${cur} ${cls}` : cls }
}

/** DOM-id-safe name (strip `[` `]` `.`), used for switcher/uploader ids. */
function domName(name: string): string {
  return String(name).replace(/[[\].]/g, '')
}

/** `<label for>` — label text defaults to the title-cased field name. */
export function label(name: string, value: string | null = null, attrs: Attrs = {}): string {
  const text = value ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return `<label for="${escape(name)}"${attributes(attrs)}>${escape(text)}</label>`
}

/** Plain text input (alias of `input`). */
export function text(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return input(name, value, attrs, 'text')
}

/** Password input. */
export function password(name: string, attrs: Attrs = {}): string {
  return input(name, '', attrs, 'password')
}

/** Hidden input. */
export function hidden(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return input(name, value, attrs, 'hidden')
}

/** Email input. */
export function email(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return input(name, value, attrs, 'email')
}

/** URL input. */
export function url(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return input(name, value, attrs, 'url')
}

/** File input. */
export function file(name: string, attrs: Attrs = {}): string {
  return input(name, null, attrs, 'file')
}

/** Rich-text editor — a `<textarea class="editor">` (an editor addon hooks it). */
export function editor(name: string, value = '', attrs: Attrs = {}): string {
  return textarea(name, value, withClass(attrs, 'editor'))
}

/** Slider — a text input carrying `data-slider-*` (bootstrap-slider). */
export function slider(
  name: string, min: number, max: number, step: number,
  value: number | null = null, attrs: Attrs = {},
): string {
  const merged = withClass({
    ...attrs,
    'data-slider-min': min,
    'data-slider-max': max,
    'data-slider-step': step,
    'data-slider-value': value ?? '',
  }, 'slider')
  return input(name, value == null ? '' : String(value), merged, 'text')
}

/** Multi-select `<select multiple>`. */
export function selects(
  name: string, options: Record<string, string>,
  selected: string | string[] | null = null, attrs: Attrs = {},
): string {
  return select(name, options, selected, { ...attrs, multiple: true })
}

/** bootstrap-select dropdown. */
export function selectpicker(
  name: string, options: Record<string, string>,
  selected: string | string[] | null = null, attrs: Attrs = {},
): string {
  return select(name, options, selected, withClass(attrs, 'selectpicker'))
}

/** bootstrap-select dropdown (multiple). */
export function selectpickers(
  name: string, options: Record<string, string>,
  selected: string | string[] | null = null, attrs: Attrs = {},
): string {
  return selectpicker(name, options, selected, { ...attrs, multiple: true })
}

/** Dynamic SelectPage dropdown — a text input wired to an AJAX `data-source`. */
export function selectpage(
  name: string, value: string | null, source: string,
  field: string | null = null, primaryKey: string | null = null, attrs: Attrs = {},
): string {
  const merged = withClass({
    ...attrs,
    'data-source': source,
    'data-field': field ?? 'name',
    'data-primary-key': primaryKey ?? 'id',
  }, 'selectpage')
  return text(name, value, merged)
}

/** Dynamic SelectPage dropdown (multiple). */
export function selectpages(
  name: string, value: string | null, source: string,
  field: string | null = null, primaryKey: string | null = null, attrs: Attrs = {},
): string {
  return selectpage(name, value, source, field, primaryKey, { ...attrs, 'data-multiple': 'true' })
}

/** City picker — a text input wrapped in `.control-relative`. */
export function citypicker(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return `<div class='control-relative'>${text(name, value, { ...attrs, 'data-toggle': 'city-picker' })}</div>`
}

/** Switch component — hidden input + the `data-toggle="switcher"` anchor. */
export function switcher(name: string, value: string | number | null = null, attrs: Attrs = {}): string {
  const dom = domName(name)
  const yes = (attrs.yes as string | number | undefined) ?? 1
  const no = (attrs.no as string | number | undefined) ?? 0
  const color = (attrs.color as string | undefined) ?? 'success'
  const disabled = attrs.disabled ? 'disabled' : ''
  const flip = String(no) === String(value) ? 'fa-flip-horizontal text-gray' : ''
  const rest = { ...attrs }
  delete rest.yes; delete rest.no; delete rest.color; delete rest.disabled
  const btn = hidden(name, value == null ? '' : String(value), { id: `c-${dom}` })
  return `${btn}\n<a href="javascript:;" data-toggle="switcher" class="btn-switcher ${disabled}"`
    + ` data-input-id="c-${dom}" data-yes="${escape(String(yes))}" data-no="${escape(String(no))}"`
    + `${attributes(rest)}><i class="fa fa-toggle-on text-${color} ${flip} fa-2x"></i></a>`
}

/** Date-time picker — a text input with class `datetimepicker`. */
export function datetimepicker(name: string, value: string | null = null, attrs: Attrs = {}): string {
  const merged = withClass({
    'data-date-format': 'YYYY-MM-DD HH:mm:ss',
    'data-use-current': 'true',
    ...attrs,
  }, 'datetimepicker')
  return text(name, value, merged)
}

/** Date picker (date only). */
export function datepicker(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return datetimepicker(name, value, { 'data-date-format': 'YYYY-MM-DD', ...attrs })
}

/** Time picker (time only). */
export function timepicker(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return datetimepicker(name, value, { 'data-date-format': 'HH:mm:ss', ...attrs })
}

/** Date-time range — a text input with class `datetimerange`. */
export function datetimerange(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return text(name, value, withClass(attrs, 'datetimerange'))
}

/** Date range. */
export function daterange(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return datetimerange(name, value, { 'data-locale': { format: 'YYYY-MM-DD' }, ...attrs })
}

/** Time range. */
export function timerange(name: string, value: string | null = null, attrs: Attrs = {}): string {
  return datetimerange(name, value, {
    'data-locale': { format: 'HH:mm:ss' }, 'data-time-picker': 'true', ...attrs,
  })
}

/** Fieldlist — dynamic key/value editor (`<dl class="fieldlist">`). */
export function fieldlist(
  name: string, value: unknown = '', title: string[] | null = null,
  template: string | null = null, attrs: Attrs = {},
): string {
  const ins = (title ?? ['Key', 'Value']).map((t) => `<ins>${escape(t)}</ins>`).join('\n        ')
  const tpl = template ? ` data-template="${escape(template)}"` : ''
  const val = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return `<dl class="fieldlist" data-name="${escape(name)}"${tpl}${attributes(attrs)}>\n`
    + `    <dd>\n        ${ins}\n    </dd>\n`
    + `    <dd><a href="javascript:;" class="btn btn-sm btn-success btn-append"><i class="fa fa-plus"></i> Append</a></dd>\n`
    + `    <textarea name="${escape(name)}" class="form-control hide" cols="30" rows="5">${escape(val)}</textarea>\n`
    + `</dl>`
}

/** A `<button>` (defaults to `type="button"`). */
export function button(value = '', attrs: Attrs = {}): string {
  return `<button${attributes({ type: 'button', ...attrs })}>${value}</button>`
}

/** Shared faupload/fachoose input-group builder (image/upload widgets). */
function uploader(name: string, value: string | null, multiple: boolean, mimetype: string): string {
  const dom = domName(name)
  const inp = text(name, value, { size: 50, id: `c-${dom}` })
  const up = button('<i class="fa fa-upload"></i> Upload', {
    id: `faupload-${dom}`, class: 'btn btn-danger faupload', 'data-input-id': `c-${dom}`,
    'data-preview-id': `p-${dom}`, 'data-mimetype': mimetype, 'data-multiple': multiple ? 'true' : 'false',
  })
  const choose = button('<i class="fa fa-list"></i> Choose', {
    id: `fachoose-${dom}`, class: 'btn btn-primary fachoose', 'data-input-id': `c-${dom}`,
    'data-preview-id': `p-${dom}`, 'data-mimetype': mimetype, 'data-multiple': multiple ? 'true' : 'false',
  })
  return `<div class="input-group">${inp}`
    + `<div class="input-group-addon no-border no-padding"><span>${up}</span> <span>${choose}</span></div>`
    + `<span class="msg-box n-right" for="c-${dom}"></span></div>`
    + `<ul class="row list-inline faupload-preview" id="p-${dom}"></ul>`
}

/** Single-image upload widget. */
export function image(name: string, value: string | null = null): string {
  return uploader(name, value, false, 'image/*')
}

/** Multi-image upload widget. */
export function images(name: string, value: string | null = null): string {
  return uploader(name, value, true, 'image/*')
}

/** Single-file upload widget. */
export function upload(name: string, value: string | null = null): string {
  return uploader(name, value, false, '*')
}

/** Multi-file upload widget. */
export function uploads(name: string, value: string | null = null): string {
  return uploader(name, value, true, '*')
}

/** `<select>` over a numeric range `begin..end`. */
export function selectRange(
  name: string, begin: number, end: number,
  selected: string | number | null = null, attrs: Attrs = {},
): string {
  const opts: Record<string, string> = {}
  const step = begin <= end ? 1 : -1
  for (let i = begin; step > 0 ? i <= end : i >= end; i += step) opts[String(i)] = String(i)
  return select(name, opts, selected == null ? null : String(selected), attrs)
}

/** Year `<select>` over `begin..end`. */
export function selectYear(
  name: string, begin: number, end: number,
  selected: string | number | null = null, attrs: Attrs = {},
): string {
  return selectRange(name, begin, end, selected, attrs)
}

/** Month `<select>` (1–12). */
export function selectMonth(name: string, selected: string | number | null = null, attrs: Attrs = {}): string {
  const opts: Record<string, string> = {}
  for (let m = 1; m <= 12; m++) opts[String(m)] = String(m).padStart(2, '0')
  return select(name, opts, selected == null ? null : String(selected), attrs)
}

/** OOP-style facade matching PHP's `\fast\Form`. */
export const Form = {
  input, text, password, hidden, email, url, file, textarea, editor, slider,
  select, selects, selectpicker, selectpickers, selectpage, selectpages,
  citypicker, switcher, datepicker, timepicker, datetimepicker,
  daterange, timerange, datetimerange, fieldlist, button,
  image, images, upload, uploads, selectRange, selectYear, selectMonth,
  checkbox, checkboxs, radio, radios, label, token,
}
