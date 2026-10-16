// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialKeyError, decryptSecret, encryptSecret, isEncrypted } from './crypto'

const KEY = randomBytes(32).toString('base64')

beforeEach(() => {
  vi.stubEnv('CONFIG_ENCRYPTION_KEY', KEY)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('crypto', () => {
  it.each(['AAAAAAAAAAAAAAAAAAAA-token', 'x'.repeat(200)])('round trips %s', (t) => {
    const blob = encryptSecret(t)
    expect(isEncrypted(blob)).toBe(true)
    expect(blob.startsWith('enc:v1:')).toBe(true)
    expect(decryptSecret(blob)).toBe(t)
  })

  it('two encryptions of the same input differ', () => {
    expect(encryptSecret('same-token-value-1234')).not.toBe(encryptSecret('same-token-value-1234'))
  })

  it('never contains the plaintext', () => {
    const t = 'plaintext-secret-value-9876'
    expect(encryptSecret(t)).not.toContain(t)
  })

  it('throws on a tampered blob', () => {
    const blob = encryptSecret('some-token-value-12345')
    const raw = Buffer.from(blob.slice(7), 'base64url')
    raw[raw.length - 1]! ^= 1
    expect(() => decryptSecret('enc:v1:' + raw.toString('base64url'))).toThrow()
  })

  it('throws with a different key', () => {
    const blob = encryptSecret('some-token-value-12345')
    vi.stubEnv('CONFIG_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    expect(() => decryptSecret(blob)).toThrow()
  })

  it('rejects a value without the prefix', () => {
    expect(isEncrypted('plain')).toBe(false)
    expect(() => decryptSecret('plain')).toThrow()
  })

  it.each([undefined, '', Buffer.alloc(16).toString('base64')])(
    'throws CredentialKeyError for key %j without leaking the value',
    (k) => {
      vi.stubEnv('CONFIG_ENCRYPTION_KEY', k as string)
      const run = () => encryptSecret('some-token-value-12345')
      expect(run).toThrow(CredentialKeyError)
      expect(run).toThrow(/CONFIG_ENCRYPTION_KEY/)
      if (k) expect(run).not.toThrow(new RegExp(k.replace(/[+/=]/g, '.')))
    },
  )

  it('decrypts a blob produced by the worker format (enc:v1 test vector)', () => {
    vi.stubEnv('CONFIG_ENCRYPTION_KEY', 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=')
    // Verified against apps/worker/src/runner.ts decryptSecret.
    const blob =
      'enc:v1:AwMDAwMDAwMDAwMDonQ-FMtMS_zl_8n_-LxYpVKR0Wg_WnM0HyM3M5l6i2OGWY7ChKSmQxvrsYbb3A'
    expect(decryptSecret(blob)).toBe('worker-vector-token-0123456789')
  })
})

describe('crypto hardening', () => {
  it('rejects a key that is not 32 bytes after decoding', () => {
    vi.stubEnv('CONFIG_ENCRYPTION_KEY', randomBytes(16).toString('base64'))
    expect(() => encryptSecret('x')).toThrow(CredentialKeyError)
  })
})
