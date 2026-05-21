// Generic admin CRUD building blocks ported from `app\admin\library\traits\Backend`
// plus the buildparams() / selectpage() helpers in app\common\controller\Backend.
// Each admin CRUD controller wires this with its repo + a few options; the
// controller still handles HTML rendering and CSRF since those are PHP-flavour
// behaviours that don't belong in the generic service.
import fs from 'node:fs'
import path from 'node:path'
import type { Repository, ObjectLiteral, FindOptionsWhere, DeepPartial } from 'typeorm'
import { Like, In, MoreThan, LessThan, MoreThanOrEqual, LessThanOrEqual, Between, IsNull, Not, Raw, FindOperator } from 'typeorm'

// Uploads land under `ts/uploads/<yyyymm>/...` (see upload.service.ts). CSV
// import resolves the user-supplied `/uploads/...` URL against this root and
// refuses anything that escapes it.
const UPLOAD_ROOT = path.resolve(import.meta.dirname ?? '.', '../../uploads')

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes
 * (`""`), embedded newlines/commas, CRLF, and a leading UTF-8 BOM. Good enough
 * for the spreadsheet exports FastAdmin's import feature consumes.
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

export interface BackendCrudOptions {
  /** Comma-separated quick-search fields, mirrors `$searchFields`. */
  searchFields?: string
  /** Default fields a non-super-admin may modify via /multi. Default 'status'. */
  multiFields?: string
  /** Fields to drop from incoming `row[...]` payloads. */
  excludeFields?: string[]
  /** Selectpage display field. Default 'name'. */
  selectpageFields?: string | string[]
  /**
   * Data scoping per PHP `$dataLimit`:
   *   - false (default) — no filtering
   *   - 'auth'          — only rows whose `dataLimitField` is in the admin's manageable ids
   *   - 'personal'      — only rows owned by the current admin
   * Caller passes `dataLimitAdminIds` per request (computed from `AdminAuthLibrary`).
   */
  dataLimit?: false | 'auth' | 'personal'
  dataLimitField?: string                   // default 'admin_id'
  dataLimitFieldAutoFill?: boolean          // default true — fills the field on insert/edit
}

export interface DataLimitContext {
  /** Manageable admin ids (super → all/null; non-super → list). */
  adminIds: number[] | null
  /** Caller's own admin id (for personal scope + autofill). */
  selfId: number
}

export interface BuildParamsResult {
  where: FindOptionsWhere<ObjectLiteral> | Array<FindOptionsWhere<ObjectLiteral>>
  sort: string
  order: 'ASC' | 'DESC'
  offset: number
  limit: number
  page: number
}

export interface SelectpageQuery {
  q_word?: string | string[]
  searchField?: string | string[]
  keyField?: string
  showField?: string
  keyValue?: string
  pageNumber?: string | number
  pageSize?: string | number
  andOr?: string
  orderBy?: Array<[string, string]>
  isTree?: string | number
  isHtml?: string | number
  custom?: Record<string, unknown>
}

export interface IndexListResult<T> {
  total: number
  rows: T[]
}

/** A range bound: a pure-integer string becomes a number, a datetime/other
 *  string is kept verbatim (TypeORM/MySQL coerces it against the column). */
function rangeBound(s: string): string | number {
  return /^-?\d+$/.test(s) ? Number(s) : s
}

/**
 * Parse a BETWEEN / RANGE value into a TypeORM operator. In `range` mode the
 * ` - `-separated form posted by the datetimerange search widget is also
 * accepted. Returns null when there is no separator or both bounds are empty
 * (PHP `buildparams()` does `continue` in that case). One empty bound degrades
 * to a `>=` / `<=` comparison, exactly like PHP.
 */
function parseRange(raw: string, range: boolean): FindOperator<unknown> | null {
  const norm = range ? raw.replace(/ - /g, ',') : raw
  if (!norm.includes(',')) return null
  const parts = norm.split(',').slice(0, 2).map((s) => s.trim())
  const a = parts[0] ?? ''
  const b = parts[1] ?? ''
  if (a === '' && b === '') return null
  if (a !== '' && b !== '') return Between(rangeBound(a), rangeBound(b)) as FindOperator<unknown>
  if (a !== '') return MoreThanOrEqual(rangeBound(a)) as FindOperator<unknown>
  return LessThanOrEqual(rangeBound(b)) as FindOperator<unknown>
}

/** Flip a BETWEEN/RANGE operator for the NOT BETWEEN / NOT RANGE forms. */
function negateRange(op: FindOperator<unknown>): FindOperator<unknown> {
  if (op.type === 'moreThanOrEqual') return LessThan(op.value) as FindOperator<unknown>
  if (op.type === 'lessThanOrEqual') return MoreThan(op.value) as FindOperator<unknown>
  return Not(op) as FindOperator<unknown>
}

/**
 * Translate FastAdmin's `filter`/`op` JSON into a TypeORM where-clause object.
 * Ported from `app\common\controller\Backend::buildparams()` — covers
 * `= <> LIKE NOT-LIKE > >= < <= IN NOT-IN BETWEEN NOT-BETWEEN RANGE NOT-RANGE
 * FIND_IN_SET/FINDIN/FINDINSET NULL NOT-NULL`, plus PHP's value-coercion rules
 * (a literal `NULL`/`NOT NULL` value overrides the op; a quoted-empty `""`/`''`
 * value becomes an equality test on the empty string). Exported for unit tests.
 */
export function applyFilterOp(filter: Record<string, unknown>, op: Record<string, unknown>): Record<string, unknown> {
  const where: Record<string, unknown> = {}
  for (const [k, vRaw] of Object.entries(filter)) {
    if (!/^[a-zA-Z0-9_\-.]+$/.test(k)) continue
    let sym = String(op[k] ?? '=').toUpperCase()
    let v: unknown = vRaw == null ? '' : (typeof vRaw === 'string' ? vRaw.trim() : vRaw)
    if (typeof v === 'string') {
      const up = v.toUpperCase()
      if (up === 'NULL' || up === 'NOT NULL') sym = up
      if (v === '""' || v === "''") { v = ''; sym = '=' }
    }
    switch (sym) {
      case '=':
        where[k] = v
        break
      case '<>':
        where[k] = Not(v as string | number)
        break
      case 'LIKE':
      case 'LIKE %...%':
        where[k] = Like(`%${String(v).replace(/%\.\.\.%/g, '')}%`)
        break
      case 'NOT LIKE':
      case 'NOT LIKE %...%':
        where[k] = Not(Like(`%${String(v).replace(/%\.\.\.%/g, '')}%`))
        break
      case '>': where[k] = MoreThan(Number(v)); break
      case '>=': where[k] = MoreThanOrEqual(Number(v)); break
      case '<': where[k] = LessThan(Number(v)); break
      case '<=': where[k] = LessThanOrEqual(Number(v)); break
      case 'IN':
      case 'IN(...)':
        where[k] = In(Array.isArray(v) ? v as unknown[] : String(v).split(','))
        break
      case 'NOT IN':
      case 'NOT IN(...)':
        where[k] = Not(In(Array.isArray(v) ? v as unknown[] : String(v).split(',')))
        break
      case 'BETWEEN':
      case 'NOT BETWEEN': {
        const r = parseRange(String(v), false)
        if (r) where[k] = sym === 'NOT BETWEEN' ? negateRange(r) : r
        break
      }
      case 'RANGE':
      case 'NOT RANGE': {
        const r = parseRange(String(v), true)
        if (r) where[k] = sym === 'NOT RANGE' ? negateRange(r) : r
        break
      }
      case 'FINDIN':
      case 'FINDINSET':
      case 'FIND_IN_SET': {
        const items = (Array.isArray(v) ? (v as unknown[]).map(String) : String(v).replace(/ /g, ',').split(','))
          .map((s) => s.trim()).filter((s) => s !== '')
        if (items.length === 0) break
        const clause = items
          .map((it) => `FIND_IN_SET('${it.replace(/'/g, "''")}', \`${k}\`)`)
          .join(' AND ')
        where[k] = Raw(() => `(${clause})`)
        break
      }
      case 'NULL':
      case 'IS NULL':
        where[k] = IsNull()
        break
      case 'NOT NULL':
      case 'IS NOT NULL':
        where[k] = Not(IsNull())
        break
      default:
        break
    }
  }
  return where
}

/**
 * Parse a parse_str-style payload like `status=hidden&weigh=10` into an object.
 * Mirrors PHP's parse_str() used for /multi's `params` field.
 */
export function parseStr(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const sp = new URLSearchParams(s)
  for (const [k, v] of sp.entries()) out[k] = v
  return out
}

export class BackendCrudService<T extends ObjectLiteral> {
  constructor(
    private readonly repo: Repository<T>,
    private readonly opts: BackendCrudOptions = {},
  ) {}

  /** PHP's buildparams() — translates FA's search/filter/op/sort/order to TypeORM. */
  buildParams(query: Record<string, unknown>): BuildParamsResult {
    const search = String(query.search ?? '').trim()
    const filterJson = String(query.filter ?? '')
    const opJson = String(query.op ?? '')
    const pk = this.repo.metadata.primaryColumns[0]?.propertyName ?? 'id'
    const sort = String(query.sort ?? pk)
    const order = (String(query.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC'
    const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0)
    let limit = Math.max(0, parseInt(String(query.limit ?? '0'), 10) || 0)
    limit = limit || 999999
    const page = query.page != null
      ? Math.max(0, parseInt(String(query.page), 10) || 1)
      : (limit ? Math.floor(offset / limit) + 1 : 1)

    let filter: Record<string, unknown> = {}
    let op: Record<string, unknown> = {}
    try { filter = filterJson ? JSON.parse(filterJson) : {} } catch { filter = {} }
    try { op = opJson ? JSON.parse(opJson) : {} } catch { op = {} }

    const where: FindOptionsWhere<ObjectLiteral> = applyFilterOp(
      filter as Record<string, unknown>,
      op as Record<string, unknown>,
    ) as FindOptionsWhere<ObjectLiteral>

    if (search) {
      const fields = (this.opts.searchFields ?? pk).split(',').map((s) => s.trim()).filter(Boolean)
      if (fields.length > 0) {
        // OR-LIKE the term across every searchfield (PHP joins them with `|`).
        const escaped = search.replace(/\\/g, '\\\\').replace(/'/g, "''")
        const orParts = fields.map((f) => `\`${f}\` LIKE '%${escaped}%'`).join(' OR ')
        // Anchor the Raw on a REAL searchfield column — find()/findAndCount()
        // validate where-keys against entity columns, so a synthetic key would
        // throw. Prefer a column the filter hasn't already constrained.
        const anchor = fields.find((f) => !(f in where)) ?? fields[0]!
        ;(where as Record<string, unknown>)[anchor] = Raw(() => `(${orParts})`)
      }
    }

    return { where, sort, order, offset, limit, page }
  }

  /**
   * Build a simple list result: {total, rows}. Caller supplies pre-built where
   * (often from buildParams or a custom predicate) and optionally a data-limit
   * context so non-super admins only see their own rows.
   */
  async index(
    query: Record<string, unknown>,
    overrideWhere?: FindOptionsWhere<T>,
    ctx?: DataLimitContext,
  ): Promise<IndexListResult<T>> {
    const { where: baseWhere, sort, order, offset, limit } = this.buildParams(query)
    const where = (overrideWhere ?? (baseWhere as FindOptionsWhere<T>)) as FindOptionsWhere<T>
    let cleanWhere = this.applyDataLimit(where, ctx) as FindOptionsWhere<T>
    // SoftDelete parity: when the entity has a `deletetime` column, the normal
    // list view excludes recycle-bin rows (deletetime IS NOT NULL). PHP's
    // SoftDelete trait does this transparently; recyclebin() opts back in.
    if (
      this.repo.metadata.findColumnWithPropertyName('deletetime') &&
      (cleanWhere as Record<string, unknown>).deletetime === undefined
    ) {
      cleanWhere = { ...(cleanWhere as Record<string, unknown>), deletetime: IsNull() } as FindOptionsWhere<T>
    }
    const orderObj = { [sort]: order } as unknown as Record<string, 'ASC' | 'DESC'>
    const [rows, total] = await this.repo.findAndCount({
      where: cleanWhere,
      order: orderObj,
      skip: offset,
      take: limit,
    })
    return { total, rows }
  }

  /** Apply dataLimit scope to a where clause. Returns the where unchanged when scope is disabled or caller is super. */
  private applyDataLimit(where: FindOptionsWhere<T>, ctx?: DataLimitContext): FindOptionsWhere<T> {
    const scope = this.opts.dataLimit
    if (!scope || !ctx) return where
    const field = this.opts.dataLimitField ?? 'admin_id'
    if (!this.repo.metadata.findColumnWithPropertyName(field)) return where
    if (scope === 'personal') {
      return { ...(where as Record<string, unknown>), [field]: ctx.selfId } as FindOptionsWhere<T>
    }
    // 'auth' — null adminIds = super (full access), empty array = no rows.
    if (ctx.adminIds === null) return where
    if (ctx.adminIds.length === 0) {
      return { ...(where as Record<string, unknown>), [field]: -1 } as FindOptionsWhere<T>
    }
    return { ...(where as Record<string, unknown>), [field]: In(ctx.adminIds) } as FindOptionsWhere<T>
  }

  /** Strip `excludeFields` from `params` before saving. */
  preExcludeFields(params: Record<string, unknown>): Record<string, unknown> {
    if (!this.opts.excludeFields || this.opts.excludeFields.length === 0) return params
    const out = { ...params }
    for (const f of this.opts.excludeFields) delete out[f]
    return out
  }

  /**
   * Collapse the structured values a FastAdmin form posts into the scalar
   * shapes the (varchar/text) DB columns expect. Without this, handing an
   * array straight to TypeORM throws "Column count doesn't match value count".
   *
   *   - `name[]` multi-selects / `set` fields arrive as scalar arrays →
   *     comma-joined (PHP's generated `setXxxAttr` mutator does the same
   *     `implode(',', $value)`).
   *   - A `fieldlist` posts BOTH its visible row inputs (`row[x][i][key]`)
   *     and its hidden `<textarea name="row[x]">`; Express's `qs` parser can't
   *     last-wins like PHP does, so it merges them into one array whose final
   *     element is the textarea's authoritative JSON string. Detect that shape
   *     (objects + a trailing string) and keep the trailing string.
   *   - Any other plain object / object-array → JSON-encoded.
   */
  private normalizeRow(params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        const last = v[v.length - 1]
        const hasObjects = v.some((x) => x !== null && typeof x === 'object')
        if (hasObjects && typeof last === 'string') {
          out[k] = last // fieldlist collision — the textarea JSON wins
        } else if (v.every((x) => x === null || typeof x !== 'object')) {
          out[k] = v.map((x) => String(x ?? '')).join(',') // multi-select → CSV
        } else {
          out[k] = JSON.stringify(v)
        }
      } else if (v !== null && typeof v === 'object') {
        out[k] = JSON.stringify(v)
      } else {
        out[k] = v
      }
    }
    return out
  }

  /** Generic CREATE — `row` param shape from PHP's `row/a`. */
  async add(params: Record<string, unknown>): Promise<{ ok: boolean; id?: number; error?: string }> {
    const cleaned = this.normalizeRow(this.preExcludeFields(params))
    const now = Math.floor(Date.now() / 1000)
    const meta = this.repo.metadata
    const insertBag = { ...cleaned } as Record<string, unknown>
    // ThinkPHP autoWriteTimestamp populates createtime/updatetime when columns exist.
    if (meta.findColumnWithPropertyName('createtime') && insertBag.createtime == null) insertBag.createtime = now
    if (meta.findColumnWithPropertyName('updatetime') && insertBag.updatetime == null) insertBag.updatetime = now
    try {
      const entity = this.repo.create(insertBag as Partial<T>)
      const saved = await this.repo.save(entity)
      const idCol = meta.primaryColumns[0]?.propertyName ?? 'id'
      return { ok: true, id: (saved as Record<string, unknown>)[idCol] as number }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async findById(id: number): Promise<T | null> {
    const pk = this.repo.metadata.primaryColumns[0]?.propertyName ?? 'id'
    return this.repo.findOneBy({ [pk]: id } as FindOptionsWhere<T>)
  }

  /** Generic UPDATE — applies `params` onto row pk=id. */
  async edit(id: number, params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const cleaned = this.normalizeRow(this.preExcludeFields(params))
    const now = Math.floor(Date.now() / 1000)
    const meta = this.repo.metadata
    const updateBag = { ...cleaned } as Record<string, unknown>
    if (meta.findColumnWithPropertyName('updatetime') && updateBag.updatetime == null) updateBag.updatetime = now
    const pk = meta.primaryColumns[0]?.propertyName ?? 'id'
    try {
      const existing = await this.repo.findOneBy({ [pk]: id } as FindOptionsWhere<T>)
      if (!existing) return { ok: false, error: 'No Results were found' }
      Object.assign(existing as Record<string, unknown>, updateBag)
      await this.repo.save(existing)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /**
   * Generic DELETE — accepts CSV ids string or array. Returns affected count.
   * If the entity has a `deletetime` column (PHP SoftDelete trait equivalent),
   * runs an UPDATE instead so the row goes into the recycle bin.
   */
  async del(ids: string | number[]): Promise<number> {
    const idArr = this.parseIds(ids)
    if (idArr.length === 0) return 0
    const pk = this.repo.metadata.primaryColumns[0]?.propertyName ?? 'id'
    if (this.repo.metadata.findColumnWithPropertyName('deletetime')) {
      const now = Math.floor(Date.now() / 1000)
      const res = await this.repo.update(
        { [pk]: In(idArr) } as FindOptionsWhere<T>,
        { deletetime: now } as unknown as Partial<T>,
      )
      return res.affected ?? 0
    }
    const res = await this.repo.delete({ [pk]: In(idArr) } as FindOptionsWhere<T>)
    return res.affected ?? 0
  }

  /** List soft-deleted rows. Only works on entities with a `deletetime` column. */
  async recyclebin(query: Record<string, unknown>): Promise<IndexListResult<T>> {
    if (!this.repo.metadata.findColumnWithPropertyName('deletetime')) return { total: 0, rows: [] }
    const { sort, order, offset, limit } = this.buildParams(query)
    const orderObj = { [sort]: order } as unknown as Record<string, 'ASC' | 'DESC'>
    const [rows, total] = await this.repo.findAndCount({
      where: { deletetime: Not(IsNull()) } as unknown as FindOptionsWhere<T>,
      order: orderObj,
      skip: offset,
      take: limit,
    })
    return { total, rows }
  }

  /**
   * Permanently remove rows previously soft-deleted. An empty `ids` empties
   * the whole recycle bin — PHP Backend::destroy() parity, which is what the
   * `.btn-destroyall` toolbar button POSTs (no ids). Only ever touches rows
   * already in the bin (`deletetime IS NOT NULL`), never live rows.
   */
  async destroy(ids: string | number[]): Promise<number> {
    if (!this.repo.metadata.findColumnWithPropertyName('deletetime')) return 0
    const idArr = this.parseIds(ids)
    const pk = this.repo.metadata.primaryColumns[0]?.propertyName ?? 'id'
    const where: Record<string, unknown> = { deletetime: Not(IsNull()) }
    if (idArr.length > 0) where[pk] = In(idArr)
    const res = await this.repo.delete(where as unknown as FindOptionsWhere<T>)
    return res.affected ?? 0
  }

  /**
   * Bring rows back from the recycle bin (clears `deletetime`). An empty `ids`
   * restores the whole bin — PHP Backend::restore() parity, which is what the
   * `.btn-restoreall` toolbar button POSTs (no ids).
   */
  async restore(ids: string | number[]): Promise<number> {
    if (!this.repo.metadata.findColumnWithPropertyName('deletetime')) return 0
    const idArr = this.parseIds(ids)
    const pk = this.repo.metadata.primaryColumns[0]?.propertyName ?? 'id'
    const where: Record<string, unknown> = { deletetime: Not(IsNull()) }
    if (idArr.length > 0) where[pk] = In(idArr)
    const res = await this.repo.update(
      where as unknown as FindOptionsWhere<T>,
      { deletetime: null } as unknown as Partial<T>,
    )
    return res.affected ?? 0
  }

  private parseIds(ids: string | number[]): number[] {
    return Array.isArray(ids)
      ? ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : String(ids).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0)
  }

  /**
   * CSV import — parse a previously-uploaded `.csv` file and bulk-insert its
   * rows. Mirrors PHP `Backend::import()`:
   *   - the first CSV line is a header row;
   *   - each header cell is resolved to a column, matching the column COMMENT
   *     first (PHP's default `importHeadType = 'comment'`) then the column
   *     NAME, so spreadsheets exported with human-readable headings import
   *     cleanly;
   *   - pk / createtime / updatetime / deletetime cells are ignored — the pk
   *     auto-increments and the timestamps are stamped fresh on insert.
   *
   * `fileUrl` is the `/uploads/...` URL returned by the upload endpoint; it is
   * resolved against the uploads dir and rejected if it escapes that root.
   * Excel (.xls/.xlsx) is intentionally out of scope — CSV only.
   */
  async import(
    fileUrl: string,
    headType: 'comment' | 'name' = 'comment',
  ): Promise<{ ok: boolean; count?: number; error?: string }> {
    const rel = String(fileUrl).replace(/^\/+/, '')
    if (!rel.startsWith('uploads/')) return { ok: false, error: 'No results were found' }
    const abs = path.resolve(UPLOAD_ROOT, rel.slice('uploads/'.length))
    if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) {
      return { ok: false, error: 'No results were found' }
    }
    if (!/\.csv$/i.test(abs)) return { ok: false, error: 'Unknown data format' }
    if (!fs.existsSync(abs)) return { ok: false, error: 'No results were found' }

    const rows = parseCsv(fs.readFileSync(abs, 'utf8'))
      .filter((r) => r.some((c) => c.trim() !== ''))
    if (rows.length < 2) return { ok: false, error: 'No rows were updated' }

    // header cell → column name.
    const meta = this.repo.metadata
    const byComment: Record<string, string> = {}
    const byName: Record<string, string> = {}
    for (const col of meta.columns) {
      byName[col.propertyName] = col.propertyName
      const comment = String(col.comment ?? '').trim()
      if (comment && !(comment in byComment)) byComment[comment] = col.propertyName
    }
    const headers = rows[0]!.map((h) => h.trim())
    const headerToField = headers.map((h) =>
      headType === 'name' ? (byName[h] ?? byComment[h] ?? null) : (byComment[h] ?? byName[h] ?? null),
    )

    const pk = meta.primaryColumns[0]?.propertyName ?? 'id'
    const skip = new Set([pk, 'createtime', 'updatetime', 'deletetime'])
    const insert: Array<Record<string, unknown>> = []
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r]!
      const obj: Record<string, unknown> = {}
      for (let c = 0; c < headers.length; c++) {
        const field = headerToField[c]
        if (!field || skip.has(field)) continue
        obj[field] = cells[c] ?? ''
      }
      if (Object.keys(obj).length > 0) insert.push(obj)
    }
    if (insert.length === 0) return { ok: false, error: 'No rows were updated' }

    const now = Math.floor(Date.now() / 1000)
    const hasCreate = !!meta.findColumnWithPropertyName('createtime')
    const hasUpdate = !!meta.findColumnWithPropertyName('updatetime')
    try {
      let count = 0
      for (const row of insert) {
        const bag = { ...row } as Record<string, unknown>
        if (hasCreate && bag.createtime == null) bag.createtime = now
        if (hasUpdate && bag.updatetime == null) bag.updatetime = now
        const entity = this.repo.create(bag as unknown as DeepPartial<T>)
        await this.repo.save(entity)
        count++
      }
      return { ok: true, count }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Generic /multi — apply `values` to every row whose id is in `ids`. */
  async multi(ids: string | number[], values: Record<string, unknown>, isSuperAdmin: boolean): Promise<number> {
    const idArr = Array.isArray(ids)
      ? ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : String(ids).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0)
    if (idArr.length === 0) return 0
    const allowed = (this.opts.multiFields ?? 'status').split(',').map((s) => s.trim())
    const finalValues = isSuperAdmin
      ? values
      : Object.fromEntries(Object.entries(values).filter(([k]) => allowed.includes(k)))
    if (Object.keys(finalValues).length === 0) return 0
    const meta = this.repo.metadata
    const updateBag = { ...finalValues } as Record<string, unknown>
    if (meta.findColumnWithPropertyName('updatetime')) updateBag.updatetime = Math.floor(Date.now() / 1000)
    const pk = meta.primaryColumns[0]?.propertyName ?? 'id'
    const res = await this.repo.update({ [pk]: In(idArr) } as FindOptionsWhere<T>, updateBag)
    return res.affected ?? 0
  }

  /**
   * PHP selectpage() — returns `{list: [{[keyField], [showField], pid}], total}`.
   * Supports:
   *   - keyValue       force-hit ids regardless of search
   *   - q_word[]       LIKE search across searchField[], joined by andOr
   *   - andOr          AND | OR (default OR)
   *   - orderBy        [[field, dir], ...]
   *   - custom         {field: value | [op, value]} additional WHERE clauses
   *   - isTree         when truthy, returns tree-flattened result with &nbsp; indents
   * Password/salt columns (if present) are scrubbed from each row.
   */
  async selectpage(query: SelectpageQuery): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
    const word = (Array.isArray(query.q_word) ? query.q_word : (query.q_word ? [query.q_word] : []))
      .map((s) => String(s).trim()).filter(Boolean)
    const searchField = Array.isArray(query.searchField) ? query.searchField : (query.searchField ? [query.searchField] : ['name'])
    const showField = query.showField ?? 'name'
    const keyField = query.keyField ?? 'id'
    const keyValue = query.keyValue
    const isTree = !!query.isTree && String(query.isTree) !== '0' && String(query.isTree) !== ''
    let pageNumber = Math.max(1, parseInt(String(query.pageNumber ?? '1'), 10) || 1)
    let pageSize = Math.max(1, parseInt(String(query.pageSize ?? '10'), 10) || 10)
    if (isTree) { pageNumber = 1; pageSize = 999999 }
    const andOr = String(query.andOr ?? 'and').toUpperCase() === 'AND' ? 'AND' : 'OR'
    const custom = (query.custom && typeof query.custom === 'object' ? query.custom : {}) as Record<string, unknown>

    const qb = this.repo.createQueryBuilder('t')

    if (keyValue != null && String(keyValue).length > 0) {
      const values = String(keyValue).split(',').filter((s) => s !== '')
      if (values.length > 0) {
        qb.where(`t.${keyField} IN (:...kv)`, { kv: values })
      }
    } else if (word.length > 0) {
      const clauses: string[] = []
      const params: Record<string, unknown> = {}
      word.forEach((w, wIdx) => {
        const fieldClauses = searchField.map((f, fIdx) => {
          const key = `w${wIdx}_${fIdx}`
          params[key] = `%${w}%`
          return `t.${f} LIKE :${key}`
        })
        clauses.push(`(${fieldClauses.join(' OR ')})`)
      })
      const joiner = andOr === 'AND' ? ' AND ' : ' OR '
      qb.where(clauses.join(joiner), params)
    }

    // Custom: field → value (equality) or [op, value] (op among =, <>, >, <, >=, <=, LIKE).
    for (const [field, raw] of Object.entries(custom)) {
      if (!/^[a-zA-Z0-9_]+$/.test(field)) continue
      const paramKey = `c_${field}`
      if (Array.isArray(raw) && raw.length === 2) {
        const op = String(raw[0]).toUpperCase()
        const v = raw[1]
        if (['=', '<>', '>', '<', '>=', '<=', 'LIKE'].includes(op)) {
          qb.andWhere(`t.${field} ${op} :${paramKey}`, { [paramKey]: v })
        }
      } else {
        qb.andWhere(`t.${field} = :${paramKey}`, { [paramKey]: raw })
      }
    }

    // orderBy: [['field', 'dir'], ...]. Default by pk DESC.
    const orderBy = Array.isArray(query.orderBy) ? query.orderBy : []
    if (orderBy.length > 0) {
      orderBy.forEach(([f, dir]) => {
        if (!/^[a-zA-Z0-9_]+$/.test(String(f))) return
        const d = String(dir ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
        qb.addOrderBy(`t.${f}`, d as 'ASC' | 'DESC')
      })
    } else {
      const pk = this.repo.metadata.primaryColumns[0]?.propertyName ?? 'id'
      qb.orderBy(`t.${pk}`, 'DESC')
    }

    const total = await qb.getCount()
    qb.skip((pageNumber - 1) * pageSize).take(pageSize)
    const rows = await qb.getMany()

    const fieldsOpt = this.opts.selectpageFields
    const fieldsList = Array.isArray(fieldsOpt)
      ? fieldsOpt
      : (fieldsOpt && fieldsOpt !== '*' ? String(fieldsOpt).split(',').map((s) => s.trim()) : null)

    const baseList = rows.map((r) => {
      const rec = { ...(r as unknown as Record<string, unknown>) }
      // Strip secret columns if present.
      delete rec.password
      delete rec.salt
      let item: Record<string, unknown>
      if (fieldsList) {
        item = {}
        for (const f of fieldsList) if (f in rec) item[f] = rec[f]
      } else {
        item = {
          [keyField]: rec[keyField] ?? '',
          [showField]: rec[showField] ?? '',
        }
      }
      const pid = rec.pid ?? rec.parent_id ?? 0
      item.pid = pid
      return item
    })

    let list = baseList
    if (isTree && !keyValue) {
      // Late require to avoid a circular import.
      const { Tree } = require('../common/tree.ts') as { Tree: new <X>() => { init: (a: Array<Record<string, unknown>>, p?: string) => unknown; getTreeArray: (id: number) => unknown; getTreeList: (data: unknown, field: string) => Array<Record<string, unknown>> } }
      const tree = new Tree()
      tree.init(baseList as Array<Record<string, unknown>>, 'pid')
      list = tree.getTreeList(tree.getTreeArray(0), showField) as Array<Record<string, unknown>>
    }

    return { list, total }
  }
}
