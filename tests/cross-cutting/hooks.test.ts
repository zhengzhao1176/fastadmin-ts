// Unit coverage for the behavior-hook system — doc 174 (行为事件).
//   - HookService.filter(): the new synchronous filter chain behind `view_filter`
//   - HookService.listen(): handler param-mutation (behind config_init etc.)
//   - BackendConfigService fires `upload_config_init` + `config_init`
// Pure / DI-free — services are constructed directly with stub deps.
import { describe, expect, it } from 'vitest'
import { HookService } from '../../ts/src/services/hook.service.ts'
import { BackendConfigService } from '../../ts/src/services/backend-config.service.ts'

const fakeReq = (): never => ({
  originalUrl: '/admin.php/index/index',
  url: '/admin.php/index/index',
  headers: {},
  query: {},
  cookies: {},
  get: () => '',
  protocol: 'http',
}) as never

describe('HookService.filter — synchronous filter chain (view_filter)', () => {
  it('threads the value through handlers in registration order', () => {
    const h = new HookService()
    h.add<string>('view_filter', (v) => v + 'A')
    h.add<string>('view_filter', (v) => v + 'B')
    expect(h.filter('view_filter', 'X')).toBe('XAB')
  })
  it('a handler that returns nothing leaves the value unchanged', () => {
    const h = new HookService()
    h.add<string>('view_filter', () => undefined)
    expect(h.filter('view_filter', 'keep')).toBe('keep')
  })
  it('no handlers → value passes straight through', () => {
    expect(new HookService().filter('view_filter', 'untouched')).toBe('untouched')
  })
  it('a throwing handler is swallowed and does not break the chain', () => {
    const h = new HookService()
    h.add<string>('view_filter', () => { throw new Error('bad filter') })
    h.add<string>('view_filter', (v) => v + '!')
    expect(h.filter('view_filter', 'ok')).toBe('ok!')
  })
})

describe('HookService.listen — handler param mutation (config_init etc.)', () => {
  it('handlers mutate the shared params object', async () => {
    const h = new HookService()
    h.add<{ allow: boolean }>('admin_nologin', (p) => { p.allow = true })
    const r = await h.listen('admin_nologin', { allow: false })
    expect(r.params.allow).toBe(true)
  })
  it('a throwing handler is collected into errors, not rethrown', async () => {
    const h = new HookService()
    h.add('x', () => { throw new Error('boom') })
    const r = await h.listen('x', {})
    expect(r.errors).toHaveLength(1)
  })
})

describe('BackendConfigService — upload_config_init / config_init hooks (doc 174)', () => {
  it('fires upload_config_init so addons can patch the upload block', async () => {
    const h = new HookService()
    h.add<{ upload: Record<string, unknown> }>('upload_config_init', (p) => {
      p.upload.storage = 'oss'
      p.upload.uploadurl = '/addons/alioss/upload'
    })
    const bc = new BackendConfigService(undefined, h)
    const cfg = await bc.build(fakeReq())
    expect(cfg.upload.storage).toBe('oss')
    expect(cfg.upload.uploadurl).toBe('/addons/alioss/upload')
  })
  it('fires config_init with the whole config', async () => {
    const h = new HookService()
    let seen: unknown = null
    h.add<{ config: unknown }>('config_init', (p) => { seen = p.config })
    const bc = new BackendConfigService(undefined, h)
    const cfg = await bc.build(fakeReq())
    expect(seen).toBe(cfg)
  })
  it('builds fine with no HookService bound', async () => {
    const bc = new BackendConfigService()
    const cfg = await bc.build(fakeReq())
    expect(cfg.modulename).toBeTruthy()
  })
})
