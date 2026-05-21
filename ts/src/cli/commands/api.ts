// `bin/think api` — scans ts/src/modules/*/*.controller.ts and emits an HTML
// API doc at `public/api.html` listing every endpoint, method, path, and
// param decorators. Mirrors PHP's `php think api`.
import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

interface ApiEndpoint {
  module: string
  controller: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL'
  path: string
  handler: string
  params: Array<{ name: string; decorator: string; type: string }>
}

export function register(prog: Command): void {
  prog
    .command('api')
    .description('Generate an HTML API doc by scanning controller decorators.')
    .option('-o, --out <path>', 'Output HTML path', 'public/api.html')
    .action((opts: { out: string }) => {
      try {
        const endpoints = scan()
        const html = render(endpoints)
        const outPath = path.resolve(REPO_ROOT, opts.out)
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.writeFileSync(outPath, html)
        // eslint-disable-next-line no-console
        console.log(`✅ wrote ${path.relative(REPO_ROOT, outPath)} (${endpoints.length} endpoints)`)
        process.exit(0)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('❌ api gen failed:', (e as Error).message)
        process.exit(1)
      }
    })
}

function scan(): ApiEndpoint[] {
  const modulesRoot = path.join(REPO_ROOT, 'src', 'modules')
  const endpoints: ApiEndpoint[] = []
  for (const moduleDir of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
    if (!moduleDir.isDirectory()) continue
    const moduleName = moduleDir.name
    const subdir = path.join(modulesRoot, moduleName)
    for (const f of fs.readdirSync(subdir)) {
      if (!f.endsWith('.controller.ts')) continue
      scanFile(path.join(subdir, f), moduleName, endpoints)
    }
  }
  return endpoints.sort((a, b) => (a.module + a.path).localeCompare(b.module + b.path))
}

function scanFile(file: string, module: string, out: ApiEndpoint[]): void {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  for (const node of src.statements) {
    if (!ts.isClassDeclaration(node) || !node.name) continue
    const controllerName = node.name.text
    let prefix = ''
    for (const dec of ts.getDecorators(node) ?? []) {
      if (ts.isCallExpression(dec.expression) && ts.isIdentifier(dec.expression.expression) && dec.expression.expression.text === 'Controller') {
        const arg = dec.expression.arguments[0]
        if (arg && ts.isStringLiteral(arg)) prefix = arg.text
      }
    }
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue
      const handler = member.name.getText(src)
      for (const dec of ts.getDecorators(member) ?? []) {
        if (!ts.isCallExpression(dec.expression) || !ts.isIdentifier(dec.expression.expression)) continue
        const decName = dec.expression.expression.text
        if (!['Get', 'Post', 'Put', 'Delete', 'All', 'Patch'].includes(decName)) continue
        const arg = dec.expression.arguments[0]
        const subpath = (arg && ts.isStringLiteral(arg)) ? arg.text : ''
        const fullPath = '/' + [prefix, subpath].filter(Boolean).join('/')
        const params: ApiEndpoint['params'] = []
        for (const p of member.parameters) {
          if (!p.name || !ts.isIdentifier(p.name)) continue
          const pdec = (ts.getDecorators(p) ?? []).map((d) => {
            if (ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)) return d.expression.expression.text
            if (ts.isIdentifier(d.expression)) return d.expression.text
            return null
          }).find((s) => !!s) as string | undefined
          if (!pdec) continue
          params.push({
            name: p.name.text,
            decorator: pdec,
            type: p.type ? p.type.getText(src) : 'any',
          })
        }
        out.push({
          module,
          controller: controllerName,
          method: (decName === 'All' ? 'ALL' : decName.toUpperCase()) as ApiEndpoint['method'],
          path: fullPath,
          handler,
          params,
        })
      }
    }
  }
}

function render(endpoints: ApiEndpoint[]): string {
  const byModule = new Map<string, ApiEndpoint[]>()
  for (const e of endpoints) {
    if (!byModule.has(e.module)) byModule.set(e.module, [])
    byModule.get(e.module)!.push(e)
  }
  let body = ''
  for (const [mod, list] of byModule.entries()) {
    body += `<h2>${esc(mod)} module — ${list.length} endpoints</h2>\n<table>\n`
    body += `<thead><tr><th>Method</th><th>Path</th><th>Controller</th><th>Handler</th><th>Params</th></tr></thead>\n<tbody>\n`
    for (const e of list) {
      const params = e.params.map((p) => `<code>@${esc(p.decorator)}</code> ${esc(p.name)}<small>: ${esc(p.type)}</small>`).join(', ')
      body += `<tr><td><span class="m m-${e.method}">${e.method}</span></td><td><code>${esc(e.path)}</code></td><td>${esc(e.controller)}</td><td><code>${esc(e.handler)}</code></td><td>${params}</td></tr>\n`
    }
    body += `</tbody></table>\n`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>fastadmin-ts API</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 1200px; margin: 2em auto; padding: 0 1em; color: #333; }
  h1 { border-bottom: 2px solid #899fe1; padding-bottom: .3em; }
  h2 { margin-top: 2em; color: #555; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: .5em .8em; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  .m { display: inline-block; padding: 2px 8px; border-radius: 3px; color: white; font-size: 11px; font-weight: bold; }
  .m-GET { background: #4caf50; } .m-POST { background: #2196f3; }
  .m-PUT { background: #ff9800; } .m-DELETE { background: #f44336; } .m-ALL { background: #9e9e9e; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  small { color: #888; }
</style></head><body>
<h1>fastadmin-ts API reference</h1>
<p>Auto-generated from controller decorators. Total <strong>${endpoints.length}</strong> endpoints across <strong>${byModule.size}</strong> modules.</p>
${body}
</body></html>`
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
