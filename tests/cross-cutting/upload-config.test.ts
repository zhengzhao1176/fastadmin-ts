// Unit coverage for the upload-config helpers — doc 177 (文件上传):
//   - `savekey` path-variable substitution
//     ({year}{mon}{day}{hour}{min}{sec}{random}{random32}{filename}{suffix}{.suffix}{filemd5})
//   - `maxsize` human-size parsing (10mb / 2097152 / 1kb …)
//   - `mimetype` allow-list matching (extension / mimetype / image/* wildcard)
// Pure functions — no DB / no HTTP server.
import { describe, expect, it } from 'vitest'
import { parseMaxsize, mimetypeAllowed, resolveSavekey } from '../../ts/src/services/upload.service.ts'

describe('parseMaxsize', () => {
  it('10mb → 10485760', () => expect(parseMaxsize('10mb')).toBe(10 * 1024 * 1024))
  it('bare bytes 2097152', () => expect(parseMaxsize('2097152')).toBe(2097152))
  it('1kb → 1024', () => expect(parseMaxsize('1kb')).toBe(1024))
  it('1gb', () => expect(parseMaxsize('1gb')).toBe(1024 ** 3))
  it('case-insensitive 5MB', () => expect(parseMaxsize('5MB')).toBe(5 * 1024 * 1024))
  it('garbage → 0', () => expect(parseMaxsize('abc')).toBe(0))
})

describe('mimetypeAllowed', () => {
  it('* allows anything', () => expect(mimetypeAllowed('csv', 'text/csv', '*')).toBe(true))
  it('empty allows anything', () => expect(mimetypeAllowed('csv', 'text/csv', '')).toBe(true))
  it('extension whitelist hit', () => expect(mimetypeAllowed('jpg', 'image/jpeg', 'jpg,png,gif')).toBe(true))
  it('extension whitelist miss', () => expect(mimetypeAllowed('csv', 'text/csv', 'jpg,png,gif')).toBe(false))
  it('mimetype literal hit', () => expect(mimetypeAllowed('bin', 'application/zip', 'application/zip')).toBe(true))
  it('image/* wildcard hit', () => expect(mimetypeAllowed('png', 'image/png', 'image/*')).toBe(true))
  it('image/* wildcard miss', () => expect(mimetypeAllowed('txt', 'text/plain', 'image/*')).toBe(false))
})

describe('resolveSavekey', () => {
  const info = { name: 'photo.JPG', ext: 'jpg', md5: 'a'.repeat(32), sha1: 'b'.repeat(40) }

  it('default savekey → /uploads/<8-digit date>/<md5>.<ext>', () => {
    const k = resolveSavekey('/uploads/{year}{mon}{day}/{filemd5}{.suffix}', info)
    expect(k).toMatch(/^\/uploads\/\d{8}\/a{32}\.jpg$/)
  })
  it('{filename} keeps the original (with extension)', () => {
    expect(resolveSavekey('/up/{filename}', info)).toBe('/up/photo.JPG')
  })
  it('{random} → 16 hex, {random32} → 32 hex', () => {
    expect(resolveSavekey('{random}', info)).toMatch(/^[0-9a-f]{16}$/)
    expect(resolveSavekey('{random32}', info)).toMatch(/^[0-9a-f]{32}$/)
  })
  it('{suffix} has no dot; {.suffix} on a no-ext file → .file', () => {
    expect(resolveSavekey('{suffix}', info)).toBe('jpg')
    expect(resolveSavekey('{.suffix}', { ...info, ext: '' })).toBe('.file')
  })
  it('{hour}{min}{sec} are zero-padded 2-digit', () => {
    expect(resolveSavekey('{hour}{min}{sec}', info)).toMatch(/^\d{6}$/)
  })
})
