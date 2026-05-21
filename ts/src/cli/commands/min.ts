// `bin/think min` — concatenate & minify the admin / frontend asset bundles
// for production. Mirrors PHP's `php think min` which used r.js (RequireJS
// optimizer); the TS replacement uses esbuild for JS and a simple
// concatenate-then-minify pass for CSS.
//
// Outputs:
//   public/assets/js/backend.min.js
//   public/assets/js/frontend.min.js
//   public/assets/css/backend.min.css
//   public/assets/css/frontend.min.css
import { Command } from 'commander'
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

export function register(prog: Command): void {
  prog
    .command('min')
    .description('Minify static assets (JS + CSS) for production.')
    .option('-m, --module <module>', 'backend | frontend | all', 'all')
    .option('-r, --resource <resource>', 'js | css | all', 'all')
    .option('-o, --optimize <optimize>', 'yes | no (sourcemap)', 'yes')
    .action(async (opts: { module: string; resource: string; optimize: string }) => {
      try {
        await runMin(opts)
        process.exit(0)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('❌ min failed:', (e as Error).message)
        process.exit(1)
      }
    })
}

async function runMin(opts: { module: string; resource: string; optimize: string }): Promise<void> {
  const modules = opts.module === 'all' ? ['backend', 'frontend'] : [opts.module]
  const resources = opts.resource === 'all' ? ['js', 'css'] : [opts.resource]
  const sourcemap = opts.optimize === 'yes' ? 'inline' as const : false

  for (const mod of modules) {
    if (resources.includes('js')) await minifyJs(mod, sourcemap)
    if (resources.includes('css')) await minifyCss(mod)
  }
}

async function minifyJs(mod: string, sourcemap: 'inline' | false): Promise<void> {
  const entry = path.join(REPO_ROOT, 'public', 'assets', 'js', `${mod}.js`)
  const out = path.join(REPO_ROOT, 'public', 'assets', 'js', `${mod}.min.js`)
  if (!fs.existsSync(entry)) {
    // eslint-disable-next-line no-console
    console.log(`→ skip ${mod}: ${entry} not found`)
    return
  }
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: false,           // RequireJS-style modules: don't try to rewrite imports
      minify: true,
      target: 'es2017',
      sourcemap,
      outfile: out,
      logLevel: 'silent',
    })
    const orig = fs.statSync(entry).size
    const min = fs.statSync(out).size
    // eslint-disable-next-line no-console
    console.log(`✅ ${path.relative(REPO_ROOT, out)} — ${formatBytes(orig)} → ${formatBytes(min)} (${Math.round(100 * (1 - min / orig))}% saved)`)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`⚠ esbuild failed for ${mod}: ${(e as Error).message}; falling back to verbatim copy`)
    fs.copyFileSync(entry, out)
  }
}

async function minifyCss(mod: string): Promise<void> {
  const entry = path.join(REPO_ROOT, 'public', 'assets', 'css', `${mod}.css`)
  const out = path.join(REPO_ROOT, 'public', 'assets', 'css', `${mod}.min.css`)
  if (!fs.existsSync(entry)) {
    // eslint-disable-next-line no-console
    console.log(`→ skip ${mod}.css: not found`)
    return
  }
  try {
    const result = await esbuild.transform(fs.readFileSync(entry, 'utf8'), {
      loader: 'css',
      minify: true,
    })
    fs.writeFileSync(out, result.code)
    const orig = fs.statSync(entry).size
    const min = fs.statSync(out).size
    // eslint-disable-next-line no-console
    console.log(`✅ ${path.relative(REPO_ROOT, out)} — ${formatBytes(orig)} → ${formatBytes(min)} (${Math.round(100 * (1 - min / orig))}% saved)`)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`⚠ esbuild CSS failed for ${mod}: ${(e as Error).message}; copying verbatim`)
    fs.copyFileSync(entry, out)
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return n + 'B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB'
  return (n / 1024 / 1024).toFixed(2) + 'MB'
}
