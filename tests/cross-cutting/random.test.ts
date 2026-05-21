// Unit coverage for the Random helper class — doc 1264 (辅助类), port of
// PHP `\fast\Random`. Pure, no DB / no HTTP server.
import { describe, expect, it } from 'vitest'
import { Random, alnum, alpha, numeric, nozero, uuid } from '../../ts/src/common/random.ts'

describe('Random.alnum / alpha / numeric / nozero', () => {
  it('alnum(6) → 6 alphanumeric chars', () => {
    const s = alnum(6)
    expect(s).toHaveLength(6)
    expect(s).toMatch(/^[0-9a-zA-Z]{6}$/)
  })
  it('alnum() defaults to length 6', () => {
    expect(alnum()).toHaveLength(6)
  })
  it('alpha(8) → 8 letters only', () => {
    expect(alpha(8)).toMatch(/^[a-zA-Z]{8}$/)
  })
  it('numeric(4) → 4 digits', () => {
    expect(numeric(4)).toMatch(/^[0-9]{4}$/)
  })
  it('nozero(10) → 10 digits with no zero', () => {
    expect(nozero(10)).toMatch(/^[1-9]{10}$/)
  })
  it('handles a length larger than the character pool', () => {
    expect(numeric(50)).toMatch(/^[0-9]{50}$/)
  })
  it('produces different values across calls', () => {
    expect(alnum(16)).not.toBe(alnum(16))
  })
})

describe('Random.build', () => {
  it("build('md5') → 32 hex chars", () => expect(Random.build('md5')).toMatch(/^[0-9a-f]{32}$/))
  it("build('sha1') → 40 hex chars", () => expect(Random.build('sha1')).toMatch(/^[0-9a-f]{40}$/))
  it("build('alnum', 12) honours length", () => expect(Random.build('alnum', 12)).toHaveLength(12))
})

describe('Random.uuid', () => {
  it('matches the UUID v4 layout', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it('is unique across calls', () => {
    expect(uuid()).not.toBe(uuid())
  })
})
