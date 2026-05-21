// Unit coverage for FastAdmin's global helper functions — docs 1262 / 1263
// (扩展 / 函数), ported from PHP `application/common.php`. Pure functions, no
// DB / no HTTP server.
import { describe, expect, it } from 'vitest'
import {
  formatBytes, datetime, humanDate, cdnurl, url, mbUcfirst,
  letterAvatar, buildSuffixImage, xssClean, ipAllowed,
} from '../../ts/src/common/helpers.ts'

describe('formatBytes', () => {
  it('bytes stay bytes', () => expect(formatBytes(512)).toBe('512B'))
  it('1024 → 1KB', () => expect(formatBytes(1024)).toBe('1KB'))
  it('10MB', () => expect(formatBytes(10 * 1024 * 1024)).toBe('10MB'))
  it('honours a delimiter', () => expect(formatBytes(2048, ' ')).toBe('2 KB'))
})

describe('datetime', () => {
  it('formats a unix timestamp with the default format', () => {
    expect(datetime(0)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
  it('honours a custom format', () => {
    expect(datetime(0, 'Y-m-d')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('humanDate', () => {
  it('returns a semantic string', () => {
    expect(typeof humanDate(Math.floor(Date.now() / 1000) - 90)).toBe('string')
  })
})

describe('cdnurl', () => {
  it('prepends an explicit string domain', () => {
    expect(cdnurl('/uploads/a.jpg', 'http://cdn.test.com')).toBe('http://cdn.test.com/uploads/a.jpg')
  })
  it('leaves absolute URLs untouched', () => {
    expect(cdnurl('http://x.com/a.jpg', 'http://cdn.test.com')).toBe('http://x.com/a.jpg')
  })
  it('leaves data: URIs untouched', () => {
    expect(cdnurl('data:image/png;base64,AAAA', 'http://cdn.test.com')).toBe('data:image/png;base64,AAAA')
  })
  it('no domain → returns the path', () => {
    expect(cdnurl('/uploads/a.jpg')).toBe('/uploads/a.jpg')
  })
})

describe('url', () => {
  it('appends query vars', () => {
    expect(url('/index/user/login', { a: 1 })).toBe('/index/user/login?a=1')
  })
  it('prepends a bare domain as http://', () => {
    expect(url('/index/user/login', {}, false, 'www.baidu.com')).toBe('http://www.baidu.com/index/user/login')
  })
  it('a plain path is unchanged', () => {
    expect(url('/index/user/login')).toBe('/index/user/login')
  })
})

describe('mbUcfirst', () => {
  it('uppercases the first char', () => expect(mbUcfirst('hello')).toBe('Hello'))
  it('empty stays empty', () => expect(mbUcfirst('')).toBe(''))
})

describe('letterAvatar', () => {
  it('returns an svg+xml base64 data URI', () => {
    expect(letterAvatar('example')).toMatch(/^data:image\/svg\+xml;base64,/)
  })
  it('embeds the uppercased first letter', () => {
    const svg = Buffer.from(letterAvatar('example').split(',')[1]!, 'base64').toString('utf8')
    expect(svg).toContain('>E<')
  })
  it('is deterministic for the same text', () => {
    expect(letterAvatar('abc')).toBe(letterAvatar('abc'))
  })
})

describe('buildSuffixImage', () => {
  it('returns an SVG carrying the uppercased suffix', () => {
    const svg = buildSuffixImage('jpg')
    expect(svg).toContain('<svg')
    expect(svg).toContain('JPG')
  })
  it('caps the suffix at 4 chars', () => {
    expect(buildSuffixImage('verylong')).toContain('VERY')
  })
})

describe('xssClean', () => {
  it('removes <script> blocks but keeps surrounding text', () => {
    const out = xssClean('hi<script>alert(1)</script>there')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).toContain('hi')
    expect(out).toContain('there')
  })
  it('strips on* event handlers', () => {
    expect(xssClean('<img src=x onerror="alert(1)">').toLowerCase()).not.toContain('onerror')
  })
  it('neutralizes javascript: URIs', () => {
    expect(xssClean('<a href="javascript:alert(1)">x</a>').toLowerCase()).not.toContain('javascript:alert')
  })
  it('leaves plain text intact', () => {
    expect(xssClean('just plain text')).toBe('just plain text')
  })
})

describe('ipAllowed', () => {
  it('allows when the deny list is empty', () => expect(ipAllowed('1.2.3.4', [])).toBe(true))
  it('blocks an exact match', () => expect(ipAllowed('1.2.3.4', ['1.2.3.4'])).toBe(false))
  it('allows a non-listed ip', () => expect(ipAllowed('1.2.3.5', ['1.2.3.4'])).toBe(true))
  it('blocks via a CIDR range', () => expect(ipAllowed('10.0.0.5', ['10.0.0.0/24'])).toBe(false))
  it('allows an ip outside the CIDR range', () => expect(ipAllowed('10.0.1.5', ['10.0.0.0/24'])).toBe(true))
})
