// Addon zip packaging + extraction. Used by `think addon --action=package`
// and `--action=install` (when given a zip URL/path). Zip-slip safe: every
// entry must resolve inside the target directory.
import { Injectable } from '@nestjs/common'
import AdmZip from 'adm-zip'
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(process.cwd())
const ADDONS_ROOT = path.join(REPO_ROOT, 'addons')
const RUNTIME_ROOT = path.join(REPO_ROOT, 'runtime', 'addons')

@Injectable()
export class AddonPackageService {
  /**
   * Zip up `ts/addons/<name>/` into `ts/runtime/addons/<name>-<version>.zip`.
   * Returns the absolute output path. Throws if the addon doesn't exist.
   */
  package(name: string): string {
    const dir = path.join(ADDONS_ROOT, name)
    if (!fs.existsSync(dir)) throw new Error(`Addon not found: ${name}`)

    const infoPath = path.join(dir, 'info.json')
    let version = '0.0.0'
    if (fs.existsSync(infoPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
        version = String(m.version ?? version)
      } catch { /* ignore */ }
    }

    fs.mkdirSync(RUNTIME_ROOT, { recursive: true })
    const out = path.join(RUNTIME_ROOT, `${name}-${version}.zip`)
    const zip = new AdmZip()
    zip.addLocalFolder(dir)
    zip.writeZip(out)
    return out
  }

  /**
   * Extract a zip into `ts/addons/<name>/`. Validates every entry's target
   * path stays inside the addon directory (prevents zip-slip CVE-2018-1002200).
   * Throws on bad entries instead of half-extracting.
   */
  extract(zipPath: string, name: string): string {
    if (!fs.existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`)
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid addon name')

    const target = path.join(ADDONS_ROOT, name)
    const targetReal = path.resolve(target)
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()

    // Pre-flight: every entry must resolve inside `target`.
    for (const e of entries) {
      const dest = path.resolve(target, e.entryName)
      if (dest !== targetReal && !dest.startsWith(targetReal + path.sep)) {
        throw new Error(`Zip-slip attempt blocked: ${e.entryName}`)
      }
    }

    fs.mkdirSync(target, { recursive: true })
    zip.extractAllTo(target, /* overwrite */ true)
    return target
  }
}
