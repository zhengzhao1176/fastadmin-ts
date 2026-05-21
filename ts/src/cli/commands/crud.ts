// `bin/think crud -t <table>` — scaffold a TypeORM entity + admin Backend CRUD
// controller for an existing MySQL table. Mirrors PHP's `php think crud -t`.
import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { introspectTable } from '../lib/schema-introspect.ts'
import {
  generateEntity, generateController, generateBackendJs, pascalCase, shortName, isProtectedTable,
} from '../lib/codegen.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

export function register(prog: Command): void {
  prog
    .command('crud')
    .description('Generate a TypeORM entity + admin CRUD controller from a MySQL table.')
    .requiredOption('-t, --table <table>', 'Source table name (e.g. fa_user)')
    .option('-f, --force', 'Overwrite existing files', false)
    .option('-d, --delete', 'Delete the previously generated files for this table', false)
    .action(async (opts: { table: string; force: boolean; delete: boolean }) => {
      try {
        await runCrud(opts)
        process.exit(0)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('❌ crud generation failed:', (e as Error).message)
        process.exit(1)
      }
    })
}

async function runCrud(opts: { table: string; force: boolean; delete: boolean }): Promise<void> {
  const slug = shortName(opts.table)
  const Pascal = pascalCase(opts.table)

  const entityPath = path.join(REPO_ROOT, 'src/entities', `${slug}.entity.ts`)
  const controllerPath = path.join(REPO_ROOT, 'src/modules/admin', `${slug}.controller.ts`)
  const backendJsPath = path.join(REPO_ROOT, 'public/assets/js/backend', `${slug}.js`)

  // -d / --delete : remove the generated trio (mirrors `php think crud -d 1`).
  if (opts.delete) {
    let removed = 0
    for (const p of [entityPath, controllerPath, backendJsPath]) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p)
        // eslint-disable-next-line no-console
        console.log(`🗑  removed ${path.relative(REPO_ROOT, p)}`)
        removed++
      }
    }
    // eslint-disable-next-line no-console
    console.log(removed ? `Deleted ${removed} generated file(s) for '${opts.table}'.` : 'Nothing to delete.')
    return
  }

  // Refuse framework/core tables — their controllers are hand-written and a
  // generated one would collide (doc: do not run CRUD on core tables).
  if (isProtectedTable(opts.table)) {
    throw new Error(
      `'${opts.table}' is a core table — it has a hand-written controller and must not be scaffolded`,
    )
  }

  const tbl = await introspectTable(opts.table)
  if (!tbl) throw new Error(`table not found: ${opts.table}`)

  for (const p of [entityPath, controllerPath, backendJsPath]) {
    if (fs.existsSync(p) && !opts.force) {
      throw new Error(`file exists: ${p} (use --force to overwrite)`)
    }
  }

  fs.mkdirSync(path.dirname(entityPath), { recursive: true })
  fs.mkdirSync(path.dirname(controllerPath), { recursive: true })
  fs.mkdirSync(path.dirname(backendJsPath), { recursive: true })

  fs.writeFileSync(entityPath, generateEntity(tbl))
  fs.writeFileSync(controllerPath, generateController(tbl))
  fs.writeFileSync(backendJsPath, generateBackendJs(tbl))

  // eslint-disable-next-line no-console
  console.log(`✅ generated ${path.relative(REPO_ROOT, entityPath)}`)
  // eslint-disable-next-line no-console
  console.log(`✅ generated ${path.relative(REPO_ROOT, controllerPath)}`)
  // eslint-disable-next-line no-console
  console.log(`✅ generated ${path.relative(REPO_ROOT, backendJsPath)}`)
  // eslint-disable-next-line no-console
  console.log(`
Next steps:
  1. Add to ts/src/app.module.ts (entities array):
       import { ${Pascal}Entity } from './entities/${slug}.entity.ts'
       // entities: [..., ${Pascal}Entity]

  2. Add to ts/src/modules/admin/admin.module.ts:
       import { ${Pascal}Controller } from './${slug}.controller.ts'
       // TypeOrmModule.forFeature([..., ${Pascal}Entity])
       // controllers:  [..., ${Pascal}Controller]

  3. Restart the server.

  4. Optionally run \`bin/think menu -c ${slug}\` to insert sidebar menu rows.
`)
}
