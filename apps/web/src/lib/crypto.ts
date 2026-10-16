// Credential encryption for secrets stored in config (sources.*.creds_ref). Server-only: never
// import from a component. Format (shared with apps/worker/src/runner.ts decryptSecret):
// "enc:v1:" + base64url(iv(12) | authTag(16) | ciphertext), AES-256-GCM, key = base64
// CONFIG_ENCRYPTION_KEY (exactly 32 bytes).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const IV_LEN = 12
const TAG_LEN = 16

export class CredentialKeyError extends Error {
  constructor(reason: string) {
    super(`CONFIG_ENCRYPTION_KEY ${reason}`)
    this.name = 'CredentialKeyError'
  }
}

function getKey(): Buffer {
  const raw = process.env.CONFIG_ENCRYPTION_KEY
  if (!raw) throw new CredentialKeyError('is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new CredentialKeyError('must be base64 for exactly 32 bytes')
  return key
}

export function isEncrypted(v: string): boolean {
  return v.startsWith(PREFIX)
}

export function encryptSecret(plain: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

export function decryptSecret(blob: string): string {
  if (!isEncrypted(blob)) throw new Error('not an enc:v1 value')
  const key = getKey()
  const raw = Buffer.from(blob.slice(PREFIX.length), 'base64url')
  if (raw.length < IV_LEN + TAG_LEN) throw new Error('enc:v1 value too short')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_LEN))
  decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN))
  return Buffer.concat([
    decipher.update(raw.subarray(IV_LEN + TAG_LEN)),
    decipher.final(),
  ]).toString('utf8')
}
