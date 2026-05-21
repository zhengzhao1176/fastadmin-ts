// `bin/think addon --action=<create|enable|disable|uninstall> --name=<name>`
// — manage local addons from the command line. Wraps AddonService for the
// runtime lifecycle bits and writes scaffolding files for `create`.
import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const ADDONS_ROOT = path.join(REPO_ROOT, 'addons')

export function register(prog: Command): void {
  prog
    .command('addon')
    .description('Manage local addons (create / enable / disable / list).')
    .requiredOption('--action <action>', 'create | list | enable | disable | package | install')
    .option('--name <name>', 'Addon name (required for create/enable/disable/package/install)')
    .option('--title <title>', 'Display title for create')
    .option('--zip <zip>', 'Path to a zip file (for install)')
    .action(async (opts: { action: string; name?: string; title?: string; zip?: string }) => {
      try {
        await runAddon(opts)
        process.exit(0)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('❌ addon command failed:', (e as Error).message)
        process.exit(1)
      }
    })
}

async function runAddon(opts: { action: string; name?: string; title?: string; zip?: string }): Promise<void> {
  if (opts.action === 'list') {
    listAddons()
    return
  }
  if (!opts.name) throw new Error(`--name is required for action=${opts.action}`)
  if (!/^[a-zA-Z0-9_]+$/.test(opts.name)) throw new Error('Addon name must be alphanumeric / underscore')

  switch (opts.action) {
    case 'create':   await createAddon(opts.name, opts.title); break
    case 'enable':   await setState(opts.name, 1); break
    case 'disable':  await setState(opts.name, 0); break
    case 'package':  await packageAddon(opts.name); break
    case 'install':  await installAddon(opts.name, opts.zip); break
    default: throw new Error(`unknown --action: ${opts.action}`)
  }
}

function listAddons(): void {
  if (!fs.existsSync(ADDONS_ROOT)) {
    // eslint-disable-next-line no-console
    console.log('No addons directory.')
    return
  }
  const entries = fs.readdirSync(ADDONS_ROOT, { withFileTypes: true })
  // eslint-disable-next-line no-console
  console.log(`Found ${entries.length} addon(s):`)
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const info = path.join(ADDONS_ROOT, ent.name, 'info.json')
    if (!fs.existsSync(info)) continue
    try {
      const m = JSON.parse(fs.readFileSync(info, 'utf8'))
      // eslint-disable-next-line no-console
      console.log(`  ${m.state === 1 ? '●' : '○'} ${m.name.padEnd(20)} v${m.version}  ${m.title}`)
    } catch {
      // eslint-disable-next-line no-console
      console.log(`  ? ${ent.name.padEnd(20)} (invalid info.json)`)
    }
  }
}

async function createAddon(name: string, title?: string): Promise<void> {
  const dir = path.join(ADDONS_ROOT, name)
  if (fs.existsSync(dir)) throw new Error(`addon exists: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })

  const info = {
    name,
    title: title ?? name,
    description: `${name} addon.`,
    version: '1.0.0',
    state: 0,
    author: 'fastadmin-ts',
    hooks: {} as Record<string, string>,
  }
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 2))

  const tsContent = `// ${name} addon. Edit freely.

export default class ${name[0]!.toUpperCase() + name.slice(1)}Addon {
  async install(): Promise<void> {}
  async uninstall(): Promise<void> {}
  async enable(): Promise<void> {}
  async disable(): Promise<void> {}
  async upgrade(_from: string, _to: string): Promise<void> {}
}
`
  fs.writeFileSync(path.join(dir, 'index.ts'), tsContent)
  // eslint-disable-next-line no-console
  console.log(`✅ created ${path.relative(REPO_ROOT, dir)}/`)
  // eslint-disable-next-line no-console
  console.log(`   Edit info.json to add hooks, then \`bin/think addon --action=enable --name=${name}\` to enable it.`)
}

async function packageAddon(name: string): Promise<void> {
  const { AddonPackageService } = await import('../../services/addon-package.service.ts')
  const svc = new AddonPackageService()
  const out = svc.package(name)
  // eslint-disable-next-line no-console
  console.log(`✅ packaged ${path.relative(REPO_ROOT, out)}`)
}

async function installAddon(name: string, zip?: string): Promise<void> {
  if (!zip) throw new Error('--zip <path> is required for install')
  if (!fs.existsSync(zip)) throw new Error(`zip not found: ${zip}`)
  const { AddonPackageService } = await import('../../services/addon-package.service.ts')
  const svc = new AddonPackageService()
  const target = svc.extract(path.resolve(zip), name)
  // eslint-disable-next-line no-console
  console.log(`✅ extracted to ${path.relative(REPO_ROOT, target)}/`)
  // eslint-disable-next-line no-console
  console.log(`   Run \`bin/think addon --action=enable --name=${name}\` to enable it.`)
}

async function setState(name: string, state: 0 | 1): Promise<void> {
  const infoPath = path.join(ADDONS_ROOT, name, 'info.json')
  if (!fs.existsSync(infoPath)) throw new Error(`addon not found: ${name}`)
  const m = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
  m.state = state
  const tmp = infoPath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2))
  fs.renameSync(tmp, infoPath)
  // eslint-disable-next-line no-console
  console.log(`✅ ${name} → state=${state} (${state === 1 ? 'enabled' : 'disabled'})`)
  // eslint-disable-next-line no-console
  console.log(`   Restart the server for route changes to take effect.`)
}
