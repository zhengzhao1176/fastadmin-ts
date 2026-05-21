// Unit coverage for FastAdmin's buildparams() operator translation — the
// `filter`/`op` JSON the bootstrap-table advanced search posts. Pure functions,
// no DB / no HTTP server. Mirrors PHP app\common\controller\Backend::buildparams.
//
// Focus: the operators added for doc 190/191 parity — RANGE / NOT RANGE,
// FIND_IN_SET, one-sided BETWEEN, and `NULL` / `""` value coercion — plus the
// quick-search OR clause that earlier was silently dropped.
import { describe, expect, it } from 'vitest'
import { applyFilterOp, BackendCrudService } from '../../ts/src/services/backend-crud.service.ts'

// A TypeORM FindOperator duck-typed (avoids importing `typeorm` from the test
// root, whose node_modules doesn't carry it). Every operator exposes `.type`.
interface OpLike { type: string; value: unknown }
const fo = (x: unknown): OpLike => x as OpLike
const isOp = (x: unknown): boolean =>
  x != null && typeof x === 'object' && typeof (x as { type?: unknown }).type === 'string'

describe('applyFilterOp — baseline operators', () => {
  it('= returns the plain value', () => {
    expect(applyFilterOp({ week: 'monday' }, { week: '=' })).toEqual({ week: 'monday' })
  })
  it('<> wraps in Not', () => {
    expect(fo(applyFilterOp({ week: 'x' }, { week: '<>' }).week).type).toBe('not')
  })
  it('LIKE wraps with % on both sides', () => {
    const op = fo(applyFilterOp({ title: 'abc' }, { title: 'LIKE' }).title)
    expect(op.type).toBe('like')
    expect(op.value).toBe('%abc%')
  })
  it('IN splits a CSV value', () => {
    const op = fo(applyFilterOp({ id: '1,2,3' }, { id: 'IN' }).id)
    expect(op.type).toBe('in')
    expect(op.value).toEqual(['1', '2', '3'])
  })
  it('> coerces to a number', () => {
    const op = fo(applyFilterOp({ views: '5' }, { views: '>' }).views)
    expect(op.type).toBe('moreThan')
    expect(op.value).toBe(5)
  })
  it('rejects non-identifier keys', () => {
    expect(applyFilterOp({ 'a;b': 'x' }, {})).toEqual({})
  })
})

describe('applyFilterOp — RANGE / NOT RANGE (doc 190 datetimerange search)', () => {
  it('RANGE two-sided → Between', () => {
    const op = fo(applyFilterOp({ createtime: '100 - 200' }, { createtime: 'RANGE' }).createtime)
    expect(op.type).toBe('between')
    expect(op.value).toEqual([100, 200])
  })
  it('RANGE accepts a comma separator too', () => {
    expect(fo(applyFilterOp({ createtime: '100,200' }, { createtime: 'RANGE' }).createtime).type).toBe('between')
  })
  // Open-ended ranges use the comma form: PHP trims the value first, so a
  // trailing/leading ` - ` would not survive — the comma form is what the
  // commonsearch widget posts when one bound is empty.
  it('RANGE open-ended start → <=', () => {
    expect(fo(applyFilterOp({ createtime: ',200' }, { createtime: 'RANGE' }).createtime).type).toBe('lessThanOrEqual')
  })
  it('RANGE open-ended end → >=', () => {
    expect(fo(applyFilterOp({ createtime: '100,' }, { createtime: 'RANGE' }).createtime).type).toBe('moreThanOrEqual')
  })
  it('RANGE keeps datetime strings (no numeric coercion)', () => {
    const op = fo(applyFilterOp(
      { activitytime: '2024-01-01 00:00:00 - 2024-12-31 23:59:59' },
      { activitytime: 'RANGE' },
    ).activitytime)
    expect(op.type).toBe('between')
    expect(op.value).toEqual(['2024-01-01 00:00:00', '2024-12-31 23:59:59'])
  })
  it('RANGE without a separator is dropped', () => {
    expect(applyFilterOp({ createtime: '100' }, { createtime: 'RANGE' })).toEqual({})
  })
  it('NOT RANGE two-sided → Not(Between)', () => {
    expect(fo(applyFilterOp({ createtime: '100 - 200' }, { createtime: 'NOT RANGE' }).createtime).type).toBe('not')
  })
})

describe('applyFilterOp — FIND_IN_SET (doc 191 set/flag search)', () => {
  it('FIND_IN_SET → Raw clause', () => {
    expect(fo(applyFilterOp({ flag: 'hot' }, { flag: 'FIND_IN_SET' }).flag).type).toBe('raw')
  })
  it('FINDIN / FINDINSET aliases work', () => {
    expect(fo(applyFilterOp({ flag: 'hot' }, { flag: 'FINDIN' }).flag).type).toBe('raw')
    expect(fo(applyFilterOp({ flag: 'hot' }, { flag: 'FINDINSET' }).flag).type).toBe('raw')
  })
})

describe('applyFilterOp — one-sided BETWEEN + value coercion', () => {
  it('BETWEEN two-sided → Between', () => {
    const op = fo(applyFilterOp({ price: '10,20' }, { price: 'BETWEEN' }).price)
    expect(op.type).toBe('between')
    expect(op.value).toEqual([10, 20])
  })
  it('BETWEEN open-ended end → >=', () => {
    expect(fo(applyFilterOp({ price: '10,' }, { price: 'BETWEEN' }).price).type).toBe('moreThanOrEqual')
  })
  it('BETWEEN open-ended start → <=', () => {
    expect(fo(applyFilterOp({ price: ',20' }, { price: 'BETWEEN' }).price).type).toBe('lessThanOrEqual')
  })
  it('value "NULL" forces IS NULL regardless of op', () => {
    expect(fo(applyFilterOp({ deletetime: 'NULL' }, {}).deletetime).type).toBe('isNull')
  })
  it('value "NOT NULL" forces IS NOT NULL', () => {
    expect(fo(applyFilterOp({ deletetime: 'NOT NULL' }, {}).deletetime).type).toBe('not')
  })
  it('quoted-empty value "" → equality on empty string', () => {
    expect(applyFilterOp({ title: '""' }, { title: 'LIKE' })).toEqual({ title: '' })
  })
})

describe('BackendCrudService.buildParams — quick search', () => {
  const stubRepo = {
    metadata: {
      primaryColumns: [{ propertyName: 'id' }],
      findColumnWithPropertyName: () => null,
    },
  }
  it('attaches an OR-LIKE Raw on a real searchfield column (no synthetic key)', () => {
    const svc = new BackendCrudService(stubRepo as never, { searchFields: 'title,nickname' })
    const r = svc.buildParams({ search: 'hello' })
    expect(Object.keys(r.where)).not.toContain('__searchOR__')
    const anchor = (r.where as Record<string, unknown>).title
    expect(isOp(anchor)).toBe(true)
    expect(fo(anchor).type).toBe('raw')
  })
  it('no search → no synthetic where keys', () => {
    const svc = new BackendCrudService(stubRepo as never, { searchFields: 'title' })
    expect(Object.keys(svc.buildParams({}).where)).toHaveLength(0)
  })
  it('parses sort / order / offset / limit / page', () => {
    const svc = new BackendCrudService(stubRepo as never, {})
    const r = svc.buildParams({ sort: 'weigh', order: 'asc', offset: '20', limit: '10' })
    expect(r.sort).toBe('weigh')
    expect(r.order).toBe('ASC')
    expect(r.offset).toBe(20)
    expect(r.limit).toBe(10)
    expect(r.page).toBe(3)
  })
})
