// Port of `fast\Rsa` from extend/fast/Rsa.php — RSA encrypt/decrypt and
// sign/verify. PHP wraps OpenSSL; here we use Node's built-in `crypto`.
// Keys are accepted as full PEM strings (the standard
// `-----BEGIN PUBLIC KEY-----` / `PRIVATE KEY` blocks).

import crypto from 'node:crypto'

/**
 * RSA-encrypt `plain` with a public key. Returns base64.
 * Uses PKCS#1 v1.5 padding to match PHP `openssl_public_encrypt()`'s default.
 */
export function encrypt(plain: string, publicKeyPem: string): string {
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, 'utf8'),
  )
  return encrypted.toString('base64')
}

/**
 * Decrypt a base64 ciphertext with a private key. Inverse of `encrypt()`;
 * matches PHP `openssl_private_decrypt()`.
 */
export function decrypt(cipherB64: string, privateKeyPem: string): string {
  const decrypted = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(cipherB64, 'base64'),
  )
  return decrypted.toString('utf8')
}

/**
 * Sign `data` with a private key. Returns a base64 signature.
 * Uses SHA-1, matching PHP `openssl_sign()`'s default algorithm.
 */
export function sign(data: string, privateKeyPem: string): string {
  const signer = crypto.createSign('RSA-SHA1')
  signer.update(data, 'utf8')
  signer.end()
  return signer.sign(privateKeyPem).toString('base64')
}

/**
 * Verify a base64 signature against `data` and a public key.
 * Returns `true` when valid, mirroring PHP `openssl_verify()` (1 / 0).
 */
export function verify(data: string, sigB64: string, publicKeyPem: string): boolean {
  const verifier = crypto.createVerify('RSA-SHA1')
  verifier.update(data, 'utf8')
  verifier.end()
  try {
    return verifier.verify(publicKeyPem, Buffer.from(sigB64, 'base64'))
  } catch {
    return false
  }
}

/**
 * Generate a fresh 2048-bit RSA key pair as PEM strings. Not in the PHP
 * class (which expects keys to be supplied) but a convenient companion for
 * tests and key bootstrapping.
 */
export function generateKeyPair(modulusLength = 2048): {
  publicKey: string
  privateKey: string
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

/**
 * Class form mirroring PHP's `new Rsa($publicKey, $privateKey)` usage, so
 * callers porting OOP PHP code can keep the same shape.
 */
export class Rsa {
  constructor(
    public publicKey = '',
    public privateKey = '',
  ) {}

  setKey(publicKey?: string, privateKey?: string): this {
    if (publicKey != null) this.publicKey = publicKey
    if (privateKey != null) this.privateKey = privateKey
    return this
  }

  pubEncrypt(data: string): string {
    return encrypt(data, this.publicKey)
  }

  privDecrypt(cipherB64: string): string {
    return decrypt(cipherB64, this.privateKey)
  }

  sign(data: string): string {
    return sign(data, this.privateKey)
  }

  verify(data: string, sigB64: string): boolean {
    return verify(data, sigB64, this.publicKey)
  }
}
