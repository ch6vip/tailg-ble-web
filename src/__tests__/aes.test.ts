import { describe, it, expect } from 'vitest'
import { aesEcbEncrypt, aesEcbDecrypt } from '../crypto/aes'
import { bytesToHex } from '../utils/hex'

const TEST_KEY = '3A60432A5C01211F291E0F4E0C132825'

describe('aesEcbEncrypt', () => {
  it('encrypts 16-byte plaintext', () => {
    const plaintext = '780000002D1A683D48271A18316E471A'
    const result = aesEcbEncrypt(TEST_KEY, plaintext)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(16)
  })

  it('produces different output for different keys', () => {
    const plaintext = '780000002D1A683D48271A18316E471A'
    const key2 = '1AF78CD35BE92F4CA06DB89EC2D7EF01'
    const r1 = aesEcbEncrypt(TEST_KEY, plaintext)
    const r2 = aesEcbEncrypt(key2, plaintext)
    expect(bytesToHex(r1)).not.toBe(bytesToHex(r2))
  })
})

describe('aesEcbDecrypt', () => {
  it('decrypts back to original plaintext', () => {
    const plaintext = '780000002D1A683D48271A18316E471A'
    const encrypted = aesEcbEncrypt(TEST_KEY, plaintext)
    const decrypted = aesEcbDecrypt(TEST_KEY, encrypted)
    expect(decrypted).toBe(plaintext)
  })
})

describe('roundtrip', () => {
  it('encrypt then decrypt preserves all AES keys', () => {
    const keys = [
      '3A60432A5C01211F291E0F4E0C132825',
      '1AF78CD35BE92F4CA06DB89EC2D7EF01',
      '1AF78CD35BE92F4CA06DB89E7C4B1E6A',
    ]
    const data = '7803C20100111111111111111234ABCD'
    for (const key of keys) {
      const enc = aesEcbEncrypt(key, data)
      const dec = aesEcbDecrypt(key, enc)
      expect(dec).toBe(data)
    }
  })
})
