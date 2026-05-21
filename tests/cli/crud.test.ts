// `php think crud` — codegen CLI tests.
//
// Strategy:
//   - withApp() creates fixture table `fa_demo_crud` in beforeEach; afterEach drops it.
//   - We pass `-c DemoCrud` explicitly: bare `-t demo_crud` would route the underscore
//     into a `demo/Crud` subdirectory, not the `DemoCrud` PascalCase file the task asks
//     for. The `-c` flag pins the controller name.
//   - Generated artefacts live under the /app volume mount (host: fastAdmin/). We use
//     containerFileExists/readContainerFile/containerRm to inspect & clean.
//   - Delete (`-d 1`) prompts for "yes" unless `-f 1` is also passed.
//   - Menu (`-u 1`) writes rows into fa_auth_rule keyed by `demo_crud%`.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  containerFileExists,
  containerRm,
  dockerExec,
  readContainerFile,
  runThink,
} from '../helpers/cli.ts'
import { closeFixtureConnection } from '../helpers/fixtures.ts'
import { withApp } from '../../scripts/db.ts'

// ---- paths under /app inside the container ----
const CTRL = '/app/application/admin/controller/DemoCrud.php'
const MODEL = '/app/application/admin/model/DemoCrud.php'
const VALIDATE = '/app/application/admin/validate/DemoCrud.php'
const VIEW_DIR = '/app/application/admin/view/demo_crud'
const VIEW_INDEX = `${VIEW_DIR}/index.html`
const VIEW_ADD = `${VIEW_DIR}/add.html`
const VIEW_EDIT = `${VIEW_DIR}/edit.html`
const JS = '/app/public/assets/js/backend/demo_crud.js'
const LANG = '/app/application/admin/lang/zh-cn/demo_crud.php'

const ALL_PATHS = [CTRL, MODEL, VALIDATE, VIEW_DIR, JS, LANG]

async function dropTable(): Promise<void> {
  await withApp(async (db) => {
    await db.query('DROP TABLE IF EXISTS `fa_demo_crud`')
  })
}

async function createTable(): Promise<void> {
  await withApp(async (db) => {
    await db.query('DROP TABLE IF EXISTS `fa_demo_crud`')
    await db.query(`CREATE TABLE fa_demo_crud (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(100) NOT NULL,
      status ENUM('normal','hidden') DEFAULT 'normal',
      createtime INT,
      updatetime INT,
      deletetime INT,
      weigh INT,
      image VARCHAR(255)
    )`)
  })
}

async function deleteMenuRows(): Promise<void> {
  await withApp(async (db) => {
    // `\\_` escapes the underscore wildcard inside MySQL's LIKE.
    await db.query("DELETE FROM `fa_auth_rule` WHERE name LIKE 'demo\\_crud%'")
  })
}

function cleanGenerated(): void {
  for (const p of ALL_PATHS) containerRm(p)
}

const CRUD_ARGS = ['crud', '-t', 'demo_crud', '-c', 'DemoCrud']

beforeEach(async () => {
  cleanGenerated()
  await deleteMenuRows()
  await createTable()
})

afterEach(async () => {
  cleanGenerated()
  await deleteMenuRows()
  await dropTable()
})

afterAll(async () => {
  await closeFixtureConnection()
})

describe('cli/think crud', () => {
  describe('basic generation', () => {
    it('exit 0 and emits all expected files', () => {
      const r = runThink({ args: CRUD_ARGS })
      expect(r.exitCode).toBe(0)
      expect(r.combined).toMatch(/Build Successed/i)

      expect(containerFileExists(CTRL)).toBe(true)
      expect(containerFileExists(MODEL)).toBe(true)
      expect(containerFileExists(VALIDATE)).toBe(true)
      expect(containerFileExists(VIEW_INDEX)).toBe(true)
      expect(containerFileExists(VIEW_ADD)).toBe(true)
      expect(containerFileExists(VIEW_EDIT)).toBe(true)
      expect(containerFileExists(JS)).toBe(true)
      expect(containerFileExists(LANG)).toBe(true)
    })

    it('controller declares PascalCase class extending Backend', () => {
      const r = runThink({ args: CRUD_ARGS })
      expect(r.exitCode).toBe(0)
      const body = readContainerFile(CTRL)
      expect(body).not.toBeNull()
      expect(body!).toMatch(/class\s+DemoCrud\s+extends\s+Backend/)
    })

    it('view & js mention column names (title, status)', () => {
      const r = runThink({ args: CRUD_ARGS })
      expect(r.exitCode).toBe(0)
      const idx = readContainerFile(VIEW_ADD) ?? ''
      expect(idx).toContain('title')
      // status is rendered as a <select> populated by statusList
      const ctrl = readContainerFile(CTRL) ?? ''
      expect(ctrl).toMatch(/statusList/)
      const js = readContainerFile(JS) ?? ''
      expect(js.length).toBeGreaterThan(0)
      expect(js).toMatch(/demo_crud/i)
    })

    it('lang file is a valid PHP return array', () => {
      const r = runThink({ args: CRUD_ARGS })
      expect(r.exitCode).toBe(0)
      const body = readContainerFile(LANG) ?? ''
      expect(body).toMatch(/^<\?php/)
      expect(body).toMatch(/return\s*\[/)
    })
  })

  describe('--force', () => {
    it('re-run without --force fails (controller exists)', () => {
      const r1 = runThink({ args: CRUD_ARGS })
      expect(r1.exitCode).toBe(0)
      const r2 = runThink({ args: CRUD_ARGS })
      expect(r2.exitCode).not.toBe(0)
      expect(r2.combined.toLowerCase()).toMatch(/already exists|force/)
    })

    it('re-run with -f 1 overwrites', () => {
      const r1 = runThink({ args: CRUD_ARGS })
      expect(r1.exitCode).toBe(0)
      const r2 = runThink({ args: [...CRUD_ARGS, '-f', '1'] })
      expect(r2.exitCode).toBe(0)
      expect(r2.combined).toMatch(/Build Successed/i)
      expect(containerFileExists(CTRL)).toBe(true)
    })
  })

  describe('--menu=1', () => {
    it('inserts rows into fa_auth_rule', async () => {
      const r = runThink({ args: [...CRUD_ARGS, '-u', '1'] })
      expect(r.exitCode).toBe(0)

      const rows = await withApp(async (db) => {
        const [rs] = await db.query(
          "SELECT name, title, type FROM `fa_auth_rule` WHERE name LIKE 'demo\\_crud%' ORDER BY name",
        )
        return rs as Array<{ name: string; title: string; type: string }>
      })

      expect(rows.length).toBeGreaterThan(0)
      const names = rows.map((r) => r.name)
      expect(names).toContain('demo_crud')
      // standard CRUD action subroutes
      expect(names.some((n) => n.startsWith('demo_crud/'))).toBe(true)
    })
  })

  describe('--delete=1', () => {
    it('with -f removes the generated files', () => {
      const gen = runThink({ args: CRUD_ARGS })
      expect(gen.exitCode).toBe(0)
      expect(containerFileExists(CTRL)).toBe(true)

      const del = runThink({ args: [...CRUD_ARGS, '-d', '1', '-f', '1'] })
      expect(del.exitCode).toBe(0)
      expect(del.combined).toMatch(/Delete Successed/i)

      expect(containerFileExists(CTRL)).toBe(false)
      expect(containerFileExists(MODEL)).toBe(false)
      expect(containerFileExists(VALIDATE)).toBe(false)
      expect(containerFileExists(VIEW_INDEX)).toBe(false)
      expect(containerFileExists(JS)).toBe(false)
      expect(containerFileExists(LANG)).toBe(false)
    })

    it('without -f errors out (interactive prompt aborts on empty stdin)', () => {
      const gen = runThink({ args: CRUD_ARGS })
      expect(gen.exitCode).toBe(0)

      const del = runThink({ args: [...CRUD_ARGS, '-d', '1'] })
      expect(del.exitCode).not.toBe(0)
      // file should still be present since the operation was aborted
      expect(containerFileExists(CTRL)).toBe(true)
    })
  })

  describe('syntax', () => {
    it('generated PHP files pass `php -l`', () => {
      const r = runThink({ args: CRUD_ARGS })
      expect(r.exitCode).toBe(0)

      for (const f of [CTRL, MODEL, VALIDATE, LANG]) {
        const lint = dockerExec(['php', '-l', f])
        expect(lint.exitCode, `php -l ${f}: ${lint.combined}`).toBe(0)
        expect(lint.combined).toMatch(/No syntax errors detected/)
      }
    })
  })

  describe('error handling', () => {
    it('unknown table exits non-zero with "table not found"', () => {
      const r = runThink({
        args: ['crud', '-t', `nosuch_${Date.now().toString(36)}`, '-c', 'NoSuchCrud'],
      })
      expect(r.exitCode).not.toBe(0)
      expect(r.combined.toLowerCase()).toContain('table not found')
    })
  })
})
