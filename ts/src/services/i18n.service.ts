// I18n loader. Reads JSON language packs from `ts/lang/<lang>/<module>/<file>.json`
// and merges them per (lang, module, controller) request. Used by:
//   - /admin.php/ajax/lang and /index/ajax/lang  (the JSONP endpoints the
//     browser hits to populate window.__())
//   - ViewService — server-side rendering can substitute `{{ __('Key') }}` with
//     the real translation (future work; the placeholder syntax is already in
//     place).
import { Injectable } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'

const LANG_ROOT = path.resolve(process.cwd(), 'lang')

@Injectable()
export class I18nService {
  private cache = new Map<string, Record<string, string>>()
  private allowList = new Set(['zh-cn', 'en'])

  allowed(lang: string): boolean { return this.allowList.has(lang) }

  /**
   * Load the merged dict for (lang, module, controller). Merges:
   *   - <lang>/<module>/index.json     (module-global)
   *   - <lang>/<module>/<controller>.json
   *   - <lang>/<module>/<dirOfController>.json  (e.g. controllername=auth.admin → loads `auth.json` too)
   */
  load(lang: string, module: string, controllername: string): Record<string, string> {
    if (!this.allowed(lang)) return {}
    const cacheKey = `${lang}/${module}/${controllername}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    const merged: Record<string, string> = {}
    this.merge(merged, lang, module, 'index')
    // Dotted controller names (e.g. `auth.admin`) → load each segment + leaf.
    const parts = controllername.split('.')
    let cur = ''
    for (const p of parts) {
      cur = cur ? cur + '/' + p : p
      this.merge(merged, lang, module, cur)
    }
    this.cache.set(cacheKey, merged)
    return merged
  }

  private merge(target: Record<string, string>, lang: string, module: string, file: string): void {
    const p = path.join(LANG_ROOT, lang, module, file + '.json')
    if (!fs.existsSync(p)) return
    try {
      const dict = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>
      Object.assign(target, dict)
    } catch {
      // ignore broken pack
    }
  }

  /** Reset the in-memory cache. Useful after editing language packs at dev time. */
  reload(): void { this.cache.clear() }
}
