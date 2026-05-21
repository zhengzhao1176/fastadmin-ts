// Unit coverage for the CRUD generator's core-table guard — doc `crud.html`
// explicitly warns against scaffolding framework tables. Pure function.
import { describe, expect, it } from 'vitest'
import { isProtectedTable } from '../../ts/src/cli/lib/codegen.ts'

describe('isProtectedTable — CRUD generation guard', () => {
  it('protects core auth/system tables (with the fa_ prefix)', () => {
    for (const t of ['fa_admin', 'fa_user', 'fa_auth_rule', 'fa_auth_group', 'fa_config', 'fa_attachment']) {
      expect(isProtectedTable(t)).toBe(true)
    }
  })
  it('protects them without the fa_ prefix too', () => {
    expect(isProtectedTable('admin')).toBe(true)
    expect(isProtectedTable('user_token')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isProtectedTable('FA_ADMIN')).toBe(true)
  })
  it('allows ordinary business tables', () => {
    for (const t of ['fa_test', 'fa_article', 'fa_order', 'fa_product']) {
      expect(isProtectedTable(t)).toBe(false)
    }
  })
})
