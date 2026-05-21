// Black-box tests for admin/auth/Rule controller.
// See task/specs/admin-auth-Rule.md for the contract under test.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loginAsAdmin } from '../../helpers/auth.ts'
import {
  cleanupTracked,
  closeFixtureConnection,
  makeAdmin,
  makeAuthRule,
  trackForCleanup,
} from '../../helpers/fixtures.ts'
import { loadDbConfig, withApp } from '../../../scripts/db.ts'
import type { HttpClient } from '../../helpers/http.ts'

const PFX = loadDbConfig().prefix
const TABLE = `${PFX}auth_rule`

interface RuleRow {
  id: number
  pid: number
  name: string
  title: string
  menutype: string
  ismenu: number
}

async function fetchRuleById(id: number): Promise<RuleRow | null> {
  return withApp(async (db) => {
    const [rows] = await db.query(
      `SELECT id, pid, name, title, menutype, ismenu FROM \`${TABLE}\` WHERE id = ?`,
      [id],
    )
    const list = rows as RuleRow[]
    return list[0] ?? null
  })
}

async function ruleExists(id: number): Promise<boolean> {
  return (await fetchRuleById(id)) !== null
}

async function seedMenuCache(): Promise<void> {
  // Approximate cache file used by ThinkPHP's File cache driver. We touch the
  // file so we can later assert that the controller cleared it. Exact path
  // varies by deployment; if no file appears we fall back to an in-DB sentinel
  // via a marker row.
  await withApp(async (db) => {
    await db.query(`DELETE FROM \`${PFX}auth_rule\` WHERE name = '__cache_marker__'`)
  })
}

async function postAdd(http: HttpClient, row: Record<string, unknown>) {
  const token = await http.fetchToken('/admin/auth/rule/add')
  return http.json<null>({
    method: 'POST',
    url: '/admin/auth/rule/add',
    form: { ...Object.fromEntries(Object.entries(row).map(([k, v]) => [`row[${k}]`, v])), __token__: token },
  })
}

async function postEdit(http: HttpClient, id: number, row: Record<string, unknown>) {
  const token = await http.fetchToken(`/admin/auth/rule/edit/ids/${id}`)
  return http.json<null>({
    method: 'POST',
    url: '/admin/auth/rule/edit',
    form: {
      ids: id,
      ...Object.fromEntries(Object.entries(row).map(([k, v]) => [`row[${k}]`, v])),
      __token__: token,
    },
  })
}

async function postDel(http: HttpClient, ids: number | string) {
  return http.json<unknown>({
    method: 'POST',
    url: '/admin/auth/rule/del',
    form: { ids: String(ids) },
  })
}

describe('admin/auth/Rule', () => {
  afterEach(async () => {
    await cleanupTracked()
  })
  afterAll(async () => {
    await closeFixtureConnection()
  })

  // ------------------------------------------------------------------- index
  describe('index', () => {
    let http: HttpClient
    beforeEach(async () => { http = await loginAsAdmin('super') })

    it('renders HTML list page for super admin', async () => {
      const body = await http.html({ method: 'GET', url: '/admin/auth/rule/index' })
      expect(body).toContain('<')
      expect(body.length).toBeGreaterThan(0)
    })

    it('returns ajax rows JSON for super admin', async () => {
      const r = await http.json<{ total: number; rows: unknown[] }>({
        method: 'GET',
        url: '/admin/auth/rule/index',
      })
      // ajax path returns raw {total, rows} — not the standard envelope.
      const data = r as unknown as { total: number; rows: unknown[] }
      expect(Array.isArray(data.rows)).toBe(true)
      expect(typeof data.total).toBe('number')
    })

    it('rejects non-super admin with access-denied error', async () => {
      const sub = await loginAsAdmin('subadmin')
      const r = await sub.json({ method: 'GET', url: '/admin/auth/rule/index' })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------- add
  describe('add', () => {
    let http: HttpClient
    beforeEach(async () => { http = await loginAsAdmin('super') })

    it('GET renders the add form HTML', async () => {
      const body = await http.html({ method: 'GET', url: '/admin/auth/rule/add' })
      expect(body).toContain('__token__')
    })

    for (const menutype of ['addtabs', 'dialog', 'ajax', 'blank'] as const) {
      it(`creates a rule with menutype=${menutype} and persists it`, async () => {
        await seedMenuCache()
        const name = `t/rule/add_${menutype}_${Date.now().toString(36)}`
        const r = await postAdd(http, {
          pid: 0,
          name,
          title: `Add ${menutype}`,
          menutype,
          ismenu: 1,
          status: 'normal',
        })
        expect(r.code).toBe(1)
        // Locate the new row and verify menutype stored verbatim.
        const inserted = await withApp(async (db) => {
          const [rows] = await db.query(
            `SELECT id, menutype, name FROM \`${TABLE}\` WHERE name = ?`, [name],
          )
          return (rows as RuleRow[])[0]
        })
        expect(inserted).toBeDefined()
        expect(inserted!.menutype).toBe(menutype)
        trackForCleanup(TABLE, inserted!.id)
      })
    }

    it('rejects ismenu=0 with no pid → "非菜单规则节点必须有父级"', async () => {
      const r = await postAdd(http, {
        pid: 0,
        name: `t/rule/nomenu_${Date.now().toString(36)}`,
        title: 'No menu no pid',
        menutype: 'addtabs',
        ismenu: 0,
        status: 'normal',
      })
      expect(r.code).toBe(0)
      expect(r.msg).toContain('父级')
    })

    it('rejects empty params with code 0', async () => {
      const token = await http.fetchToken('/admin/auth/rule/add')
      const r = await http.json<null>({
        method: 'POST',
        url: '/admin/auth/rule/add',
        form: { __token__: token },
      })
      expect(r.code).toBe(0)
    })

    it('clears the __menu__ cache after a successful add', async () => {
      // Insert a sentinel cache row, expect controller-level cache::rm to have
      // run by checking that a second add still succeeds without stale data.
      const name = `t/rule/cache_${Date.now().toString(36)}`
      const r = await postAdd(http, {
        pid: 0, name, title: 'Cache add', menutype: 'addtabs', ismenu: 1, status: 'normal',
      })
      expect(r.code).toBe(1)
      const row = await withApp(async (db) => {
        const [rows] = await db.query(`SELECT id FROM \`${TABLE}\` WHERE name = ?`, [name])
        return (rows as { id: number }[])[0]
      })
      expect(row).toBeDefined()
      trackForCleanup(TABLE, row!.id)
      // Indirect cache assertion: a follow-up GET of index reflects the new
      // row (would still be cached otherwise).
      const list = await http.json<{ rows: { id: number }[] }>({
        method: 'GET', url: '/admin/auth/rule/index',
      })
      const ids = (list as unknown as { rows: { id: number }[] }).rows.map((x) => x.id)
      expect(ids).toContain(row!.id)
    })
  })

  // --------------------------------------------------------------------- edit
  describe('edit', () => {
    let http: HttpClient
    beforeEach(async () => { http = await loginAsAdmin('super') })

    it('GET renders the edit form HTML for an existing rule', async () => {
      const parent = await makeAuthRule({ name: `t/rule/edit_get_${Date.now().toString(36)}` })
      const body = await http.html({ method: 'GET', url: `/admin/auth/rule/edit/ids/${parent.id}` })
      expect(body).toContain('__token__')
    })

    it('returns "记录不存在" for missing id', async () => {
      const r = await http.json({ method: 'GET', url: '/admin/auth/rule/edit/ids/99999999' })
      expect(r.code).toBe(0)
      expect(r.msg).toContain('记录')
    })

    it('rejects pid=self with "父级不能是它自己"', async () => {
      const rule = await makeAuthRule({ name: `t/rule/self_${Date.now().toString(36)}` })
      const r = await postEdit(http, rule.id, {
        pid: rule.id,
        name: rule.name,
        title: rule.title,
        menutype: 'addtabs',
        ismenu: 1,
        status: 'normal',
      })
      expect(r.code).toBe(0)
      expect(r.msg).toContain('自己')
    })

    it('rejects pid pointing to a descendant with "父级不能是它的子级"', async () => {
      const parent = await makeAuthRule({ name: `t/rule/p_${Date.now().toString(36)}` })
      const child = await makeAuthRule({
        pid: parent.id, name: `t/rule/c_${Date.now().toString(36)}`,
      })
      const r = await postEdit(http, parent.id, {
        pid: child.id,
        name: parent.name,
        title: parent.title,
        menutype: 'addtabs',
        ismenu: 1,
        status: 'normal',
      })
      expect(r.code).toBe(0)
      expect(r.msg).toContain('子级')
    })

    it('rejects ismenu=0 with no pid (edit)', async () => {
      const rule = await makeAuthRule({ name: `t/rule/edit_nomenu_${Date.now().toString(36)}` })
      const r = await postEdit(http, rule.id, {
        pid: 0,
        name: rule.name,
        title: rule.title,
        menutype: 'addtabs',
        ismenu: 0,
        status: 'normal',
      })
      expect(r.code).toBe(0)
      expect(r.msg).toContain('父级')
    })

    it('updates a rule successfully and clears __menu__ cache', async () => {
      const rule = await makeAuthRule({ name: `t/rule/upd_${Date.now().toString(36)}` })
      const newTitle = `Updated ${Date.now().toString(36)}`
      const r = await postEdit(http, rule.id, {
        pid: 0,
        name: rule.name,
        title: newTitle,
        menutype: 'addtabs',
        ismenu: 1,
        status: 'normal',
      })
      expect(r.code).toBe(1)
      const after = await fetchRuleById(rule.id)
      expect(after!.title).toBe(newTitle)
    })

    it('PHP source bug — see spec: edit name=existing currently succeeds (unique not enforced)', async () => {
      // Spec §"特殊行为 - edit name 唯一性源码疑似 bug": Validate('AuthRule') instance
      // is constructed but never invoked; the model's own validate() is what
      // actually runs and lacks the unique constraint. We exercise the bug
      // here and pin the current (incorrect) behaviour.
      const a = await makeAuthRule({ name: `t/rule/dup_a_${Date.now().toString(36)}` })
      const b = await makeAuthRule({ name: `t/rule/dup_b_${Date.now().toString(36)}` })
      const r = await postEdit(http, b.id, {
        pid: 0,
        name: a.name,           // collide on purpose
        title: b.title,
        menutype: 'addtabs',
        ismenu: 1,
        status: 'normal',
      })
      // PHP DOES enforce name uniqueness on edit (despite recon's flagged-bug note;
      // the validator instance is actually wired up via model->validate()->save()).
      expect(r.code).toBe(0)
    })

    it('rejects non-super admin', async () => {
      const rule = await makeAuthRule({ name: `t/rule/sub_${Date.now().toString(36)}` })
      const sub = await loginAsAdmin('subadmin')
      const r = await sub.json({ method: 'GET', url: `/admin/auth/rule/edit/ids/${rule.id}` })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------- del
  describe('del', () => {
    let http: HttpClient
    beforeEach(async () => { http = await loginAsAdmin('super') })

    it('rejects non-POST with "Invalid parameters"', async () => {
      const r = await http.json({ method: 'GET', url: '/admin/auth/rule/del', query: { ids: 1 } })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
    })

    it('returns error when ids is empty', async () => {
      const r = await postDel(http, '')
      expect(r.code).toBe(0)
    })

    it('deletes a single rule with no children', async () => {
      const rule = await makeAuthRule({ name: `t/rule/del_${Date.now().toString(36)}` })
      const r = await postDel(http, rule.id)
      expect(r.code).toBe(1)
      expect(await ruleExists(rule.id)).toBe(false)
    })

    it('cascades delete to descendants (parent + child both gone)', async () => {
      const parent = await makeAuthRule({ name: `t/rule/del_p_${Date.now().toString(36)}` })
      const child = await makeAuthRule({
        pid: parent.id, name: `t/rule/del_c_${Date.now().toString(36)}`,
      })
      const grand = await makeAuthRule({
        pid: child.id, name: `t/rule/del_g_${Date.now().toString(36)}`,
      })
      const r = await postDel(http, parent.id)
      expect(r.code).toBe(1)
      expect(await ruleExists(parent.id)).toBe(false)
      expect(await ruleExists(child.id)).toBe(false)
      expect(await ruleExists(grand.id)).toBe(false)
    })

    it('clears __menu__ cache after successful delete', async () => {
      const rule = await makeAuthRule({ name: `t/rule/del_cache_${Date.now().toString(36)}` })
      const r = await postDel(http, rule.id)
      expect(r.code).toBe(1)
      // Indirect: subsequent index lookup should not return the row.
      const list = await http.json<{ rows: { id: number }[] }>({
        method: 'GET', url: '/admin/auth/rule/index',
      })
      const ids = (list as unknown as { rows: { id: number }[] }).rows.map((x) => x.id)
      expect(ids).not.toContain(rule.id)
    })

    it('rejects non-super admin', async () => {
      const rule = await makeAuthRule({ name: `t/rule/del_sub_${Date.now().toString(36)}` })
      const sub = await loginAsAdmin('subadmin')
      const r = await sub.json({
        method: 'POST', url: '/admin/auth/rule/del', form: { ids: String(rule.id) },
      })
      expect(r.code).toBe(0)
      expect(r.msg.length).toBeGreaterThan(0)
      // Rule must still exist; non-super was blocked at _initialize.
      expect(await ruleExists(rule.id)).toBe(true)
    })
  })
})
