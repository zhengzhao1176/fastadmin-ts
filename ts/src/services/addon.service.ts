// Addon discovery + lifecycle. Mirrors PHP's think\addons\Service + the admin
// Addon controller's `install/uninstall/enable/disable/upgrade/state` flow.
//
// Layout on disk:
//   ts/addons/
//     example/
//       info.json       — manifest (see AddonManifest below)
//       index.ts        — default export = Addon class; exports `controllers`
//
// State (enabled/disabled) is the `state` field in info.json. Toggling it
// rewrites the file (atomic via temp-file rename) and runs the corresponding
// lifecycle hook. Route registration from addons is captured by main.ts at
// boot — flipping `state` therefore requires a server restart for new routes
// to mount (the disable() path can still un-register hooks at runtime).
import { Injectable, Optional } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { HookService } from './hook.service.ts'

export interface AddonManifest {
  name: string
  title: string
  description?: string
  version: string
  state: 0 | 1
  author?: string
  /** Map of event name → method name on the addon instance. */
  hooks?: Record<string, string>
}

export interface AddonLifecycle {
  install?(): Promise<void> | void
  uninstall?(): Promise<void> | void
  enable?(): Promise<void> | void
  disable?(): Promise<void> | void
  upgrade?(from: string, to: string): Promise<void> | void
}

export interface AddonLoaded {
  manifest: AddonManifest
  instance: AddonLifecycle & Record<string, unknown>
  /** Hooks this addon registered (kept so disable() can unregister them). */
  registered: Array<{ event: string; handler: (...args: unknown[]) => unknown }>
}

const ADDONS_ROOT = path.resolve(process.cwd(), 'addons')

@Injectable()
export class AddonService {
  private loaded = new Map<string, AddonLoaded>()
  private initialized = false

  constructor(@Optional() private readonly hooks?: HookService) {}

  /** Returns the list of all addon manifests on disk (cached after first call). */
  async list(): Promise<AddonManifest[]> {
    await this.scan()
    return Array.from(this.loaded.values()).map((a) => a.manifest)
  }

  async get(name: string): Promise<AddonManifest | null> {
    await this.scan()
    return this.loaded.get(name)?.manifest ?? null
  }

  async isEnabled(name: string): Promise<boolean> {
    const m = await this.get(name)
    return m?.state === 1
  }

  // ---- lifecycle ----

  async install(name: string): Promise<void> {
    const dir = path.join(ADDONS_ROOT, name)
    if (!fs.existsSync(dir)) throw new Error('Addon not exists')
    await this.scan()
    const loaded = this.loaded.get(name)
    if (!loaded) throw new Error('Addon manifest invalid')
    if (loaded.manifest.state === 1) {
      // Already installed+enabled; install is a no-op.
      return
    }
    await loaded.instance.install?.()
    await this.setState(name, 1)
  }

  async uninstall(name: string): Promise<void> {
    const dir = path.join(ADDONS_ROOT, name)
    if (!fs.existsSync(dir)) throw new Error('Addon not exists')
    await this.scan()
    const loaded = this.loaded.get(name)
    if (!loaded) throw new Error('Addon manifest invalid')
    if (loaded.manifest.state === 1) {
      await this.disable(name)
    }
    await loaded.instance.uninstall?.()
    // We leave the directory in place (matches PHP behavior: an admin can
    // re-enable by flipping state). Real removal lives in CLI / admin UI.
  }

  async enable(name: string): Promise<void> {
    await this.scan()
    const loaded = this.loaded.get(name)
    if (!loaded) throw new Error('Addon not exists')
    if (loaded.manifest.state === 1) return
    await loaded.instance.enable?.()
    this.attachHooks(loaded)
    await this.setState(name, 1)
  }

  async disable(name: string): Promise<void> {
    await this.scan()
    const loaded = this.loaded.get(name)
    if (!loaded) throw new Error('Addon not exists')
    if (loaded.manifest.state === 0) return
    this.detachHooks(loaded)
    await loaded.instance.disable?.()
    await this.setState(name, 0)
  }

  async upgrade(name: string, toVersion: string): Promise<void> {
    await this.scan()
    const loaded = this.loaded.get(name)
    if (!loaded) throw new Error('Addon not exists')
    const fromVersion = loaded.manifest.version
    await loaded.instance.upgrade?.(fromVersion, toVersion)
    loaded.manifest.version = toVersion
    await this.writeManifest(name, loaded.manifest)
  }

  // ---- internals ----

  async scan(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    if (!fs.existsSync(ADDONS_ROOT)) return
    const entries = fs.readdirSync(ADDONS_ROOT, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      await this.loadOne(ent.name).catch(() => { /* ignore broken addons */ })
    }
    // Wire hooks for already-enabled addons.
    for (const loaded of this.loaded.values()) {
      if (loaded.manifest.state === 1) this.attachHooks(loaded)
    }
  }

  private async loadOne(name: string): Promise<void> {
    const dir = path.join(ADDONS_ROOT, name)
    const infoPath = path.join(dir, 'info.json')
    if (!fs.existsSync(infoPath)) return
    let manifest: AddonManifest
    try {
      manifest = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
    } catch {
      return
    }
    if (!manifest.name) manifest.name = name

    // Try to import the addon's entry. If it fails (e.g. addon not finished
    // installing), the manifest is still listed but lifecycle calls error.
    let instance: AddonLifecycle & Record<string, unknown> = {}
    const entryPath = path.join(dir, 'index.ts')
    if (fs.existsSync(entryPath)) {
      try {
        const mod = await import(entryPath)
        if (mod && typeof mod.default === 'function') {
          instance = new mod.default()
        } else if (mod && typeof mod.default === 'object' && mod.default) {
          instance = mod.default
        } else {
          instance = mod
        }
      } catch {
        // ignore — addon's entry is broken; treat as a stub.
      }
    }

    this.loaded.set(name, { manifest, instance, registered: [] })
  }

  private attachHooks(loaded: AddonLoaded): void {
    if (!this.hooks || !loaded.manifest.hooks) return
    for (const [event, methodName] of Object.entries(loaded.manifest.hooks)) {
      const fn = loaded.instance[methodName]
      if (typeof fn === 'function') {
        const bound = fn.bind(loaded.instance) as (...args: unknown[]) => unknown
        this.hooks.add(event, bound)
        loaded.registered.push({ event, handler: bound })
      }
    }
  }

  private detachHooks(loaded: AddonLoaded): void {
    if (!this.hooks) return
    for (const r of loaded.registered) this.hooks.remove(r.event, r.handler)
    loaded.registered = []
  }

  private async setState(name: string, state: 0 | 1): Promise<void> {
    const loaded = this.loaded.get(name)
    if (!loaded) throw new Error('Addon not exists')
    loaded.manifest.state = state
    await this.writeManifest(name, loaded.manifest)
  }

  private async writeManifest(name: string, manifest: AddonManifest): Promise<void> {
    const infoPath = path.join(ADDONS_ROOT, name, 'info.json')
    const tmp = infoPath + '.tmp'
    await fs.promises.writeFile(tmp, JSON.stringify(manifest, null, 2))
    await fs.promises.rename(tmp, infoPath)
  }
}
