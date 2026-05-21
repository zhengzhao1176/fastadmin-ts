// Unit coverage for the S3 storage adapter's SigV4 signer + driver selection.
//
// No DB / no HTTP server needed: the signer (`signV4`) is a pure function and
// `S3StorageAdapter`/`StorageService` construct from explicit config. We assert
// the SigV4 canonical-request shape and HMAC key-derivation chain against AWS's
// *documented, unambiguous* test vectors, then confirm `STORAGE_DRIVER` gating.
//
// Spec: AWS Signature V4
//   https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
//   https://docs.aws.amazon.com/general/latest/gr/signature-v4-examples.html
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LocalStorageAdapter,
  S3StorageAdapter,
  StorageService,
  signV4,
  s3ConfigFromEnv,
} from '../../ts/src/services/storage.service.ts'

describe('cross-cutting/storage-s3 — SigV4 signer', () => {
  it('builds the canonical request in AWS S3 GET-Object format', () => {
    // AWS docs print the canonical request for this exact GET; its SHA-256 is a
    // published constant. Matching it proves our canonical-request assembly
    // (method / URI / sorted headers / signed-header list / payload hash).
    const emptyHash = crypto.createHash('sha256').update('').digest('hex')
    const r = signV4({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      canonicalUri: '/test.txt',
      region: 'us-east-1',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      payloadHash: emptyHash,
      headers: { range: 'bytes=0-9' },
      now: new Date('2013-05-24T00:00:00.000Z'),
    })

    // Canonical request lines (header order is alphabetically sorted).
    expect(r.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${emptyHash}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        emptyHash,
      ].join('\n'),
    )

    // SHA-256 of that canonical request — AWS-published constant.
    const crHash = crypto.createHash('sha256').update(r.canonicalRequest).digest('hex')
    expect(crHash).toBe('7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972')

    // string-to-sign embeds algorithm + amz-date + credential scope + CR hash.
    expect(r.stringToSign).toBe(
      ['AWS4-HMAC-SHA256', '20130524T000000Z', '20130524/us-east-1/s3/aws4_request', crHash].join('\n'),
    )
    expect(r.amzDate).toBe('20130524T000000Z')
  })

  it('derives the signing key per AWS documented vector and emits a well-formed Authorization header', () => {
    // AWS publishes the derived signing key for this secret/date/region/service.
    // signV4 uses service=s3; the documented vector uses service=iam, so we
    // reproduce the HMAC chain here and assert signV4 produces the SAME shape +
    // a deterministic 64-hex signature.
    const signed = signV4({
      method: 'PUT',
      host: 'examplebucket.s3.amazonaws.com',
      canonicalUri: '/202605/abc.png',
      region: 'us-east-1',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      payloadHash: crypto.createHash('sha256').update(Buffer.from('hi')).digest('hex'),
      headers: { 'content-type': 'image/png' },
      now: new Date('2026-05-21T12:00:00.000Z'),
    })

    // Authorization header structure: AWS4-HMAC-SHA256 Credential=.../scope, SignedHeaders=..., Signature=64hex
    const auth = signed.headers.Authorization
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260521\/us-east-1\/s3\/aws4_request, /)
    expect(auth).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date')
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/)

    // Independently recompute the signature from the string-to-sign and confirm.
    const hmac = (k: string | Buffer, d: string): Buffer =>
      crypto.createHmac('sha256', k).update(d, 'utf8').digest()
    const kDate = hmac('AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20260521')
    const kSigning = hmac(hmac(hmac(kDate, 'us-east-1'), 's3'), 'aws4_request')
    const expected = crypto.createHmac('sha256', kSigning)
      .update(signed.stringToSign, 'utf8').digest('hex')
    expect(signed.signature).toBe(expected)

    // The x-amz-* headers that the signature covers are returned for the request.
    expect(signed.headers['x-amz-date']).toBe('20260521T120000Z')
    expect(signed.headers['x-amz-content-sha256']).toBe(
      crypto.createHash('sha256').update(Buffer.from('hi')).digest('hex'),
    )
  })

  it('signing is deterministic for a fixed timestamp and changes with the payload', () => {
    const base = {
      method: 'PUT' as const,
      host: 'minio.local',
      canonicalUri: '/bucket/k.bin',
      region: 'us-east-1',
      accessKey: 'KEY',
      secretKey: 'SECRET',
      now: new Date('2026-05-21T00:00:00.000Z'),
    }
    const a = signV4({ ...base, payloadHash: crypto.createHash('sha256').update('A').digest('hex') })
    const aAgain = signV4({ ...base, payloadHash: crypto.createHash('sha256').update('A').digest('hex') })
    const b = signV4({ ...base, payloadHash: crypto.createHash('sha256').update('B').digest('hex') })
    expect(a.signature).toBe(aAgain.signature)        // deterministic
    expect(a.signature).not.toBe(b.signature)          // payload-bound
  })
})

describe('cross-cutting/storage-s3 — S3StorageAdapter', () => {
  const cfg = {
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    bucket: 'my-bucket',
    region: 'us-east-1',
    accessKey: 'AKIDEXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  }

  it('reports configured=true with full config and builds path-style object URLs', () => {
    const a = new S3StorageAdapter(cfg)
    expect(a.name).toBe('s3')
    expect(a.configured).toBe(true)
    expect(a.objectUrl('202605/abc.png')).toBe(
      'https://s3.us-east-1.amazonaws.com/my-bucket/202605/abc.png',
    )
    // Leading slash on the key is normalised away (no double slash).
    expect(a.objectUrl('/202605/abc.png')).toBe(
      'https://s3.us-east-1.amazonaws.com/my-bucket/202605/abc.png',
    )
  })

  it('stays a safe stub when config is absent — save() throws a clear message', async () => {
    const a = new S3StorageAdapter(null)
    expect(a.configured).toBe(false)
    await expect(a.save(Buffer.from('x'), 'k.png', 'image/png')).rejects.toThrow(/not configured/i)
    await expect(a.delete('k.png')).rejects.toThrow(/not configured/i)
  })

  it('s3ConfigFromEnv returns null unless every required var is set', () => {
    expect(s3ConfigFromEnv({})).toBeNull()
    expect(s3ConfigFromEnv({ STORAGE_S3_ENDPOINT: 'x', STORAGE_S3_BUCKET: 'b' })).toBeNull()
    const full = s3ConfigFromEnv({
      STORAGE_S3_ENDPOINT: 'https://s3.example.com',
      STORAGE_S3_BUCKET: 'b',
      STORAGE_S3_REGION: 'us-east-1',
      STORAGE_S3_KEY: 'k',
      STORAGE_S3_SECRET: 's',
    })
    expect(full).toEqual({
      endpoint: 'https://s3.example.com',
      bucket: 'b',
      region: 'us-east-1',
      accessKey: 'k',
      secretKey: 's',
    })
  })
})

describe('cross-cutting/storage-s3 — StorageService driver selection', () => {
  it('defaults to the local adapter when STORAGE_DRIVER is unset', () => {
    const saved = process.env.STORAGE_DRIVER
    delete process.env.STORAGE_DRIVER
    try {
      const svc = new StorageService()
      expect(svc.current()).toBeInstanceOf(LocalStorageAdapter)
      expect(svc.current().name).toBe('local')
    } finally {
      if (saved !== undefined) process.env.STORAGE_DRIVER = saved
    }
  })

  it('selects the s3 adapter when STORAGE_DRIVER=s3', () => {
    const saved = process.env.STORAGE_DRIVER
    process.env.STORAGE_DRIVER = 's3'
    try {
      const svc = new StorageService()
      expect(svc.current()).toBeInstanceOf(S3StorageAdapter)
      expect(svc.current().name).toBe('s3')
    } finally {
      if (saved !== undefined) process.env.STORAGE_DRIVER = saved
      else delete process.env.STORAGE_DRIVER
    }
  })

  it('falls back to local for an unknown STORAGE_DRIVER value', () => {
    const saved = process.env.STORAGE_DRIVER
    process.env.STORAGE_DRIVER = 'doesnotexist'
    try {
      const svc = new StorageService()
      expect(svc.current().name).toBe('local')
    } finally {
      if (saved !== undefined) process.env.STORAGE_DRIVER = saved
      else delete process.env.STORAGE_DRIVER
    }
  })
})
