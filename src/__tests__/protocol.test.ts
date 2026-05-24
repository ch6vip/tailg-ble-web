import { describe, it, expect } from 'vitest'
import { buildTokenRequest, buildCommand, buildCommandWithParam, buildCommand3Params } from '../ble/protocol'
import { aesEcbDecrypt } from '../crypto/aes'
import { bytesToHex } from '../utils/hex'

const TEST_KEY = '3A60432A5C01211F291E0F4E0C132825'

describe('buildTokenRequest', () => {
  it('returns 16-byte encrypted frame', () => {
    const result = buildTokenRequest(TEST_KEY)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(16)
  })

  it('decrypts to known token request plaintext', () => {
    const result = buildTokenRequest(TEST_KEY)
    const decrypted = aesEcbDecrypt(TEST_KEY, result)
    expect(decrypted).toBe('780000002D1A683D48271A18316E471A')
  })

  it('produces different ciphertext for different keys', () => {
    const key2 = '1AF78CD35BE92F4CA06DB89EC2D7EF01'
    const r1 = bytesToHex(buildTokenRequest(TEST_KEY))
    const r2 = bytesToHex(buildTokenRequest(key2))
    expect(r1).not.toBe(r2)
  })
})

describe('buildCommand', () => {
  it('returns 16-byte encrypted frame', () => {
    const result = buildCommand(TEST_KEY, '01', 'AABBCCDD')
    expect(result.length).toBe(16)
  })

  it('decrypts to correct frame structure: 7803C2 + cmd + 00 + padding + token', () => {
    const token = 'AABBCCDD'
    const result = buildCommand(TEST_KEY, '02', token)
    const decrypted = aesEcbDecrypt(TEST_KEY, result)
    expect(decrypted.startsWith('7803C2')).toBe(true)
    expect(decrypted.substring(6, 8)).toBe('02')
    expect(decrypted.substring(8, 10)).toBe('00')
    expect(decrypted.endsWith(token)).toBe(true)
  })

  it('encodes all command codes correctly', () => {
    const cmds = ['01', '02', '05', '06', '07', '08', '0D', '0E'] as const
    for (const cmd of cmds) {
      const result = buildCommand(TEST_KEY, cmd, '12345678')
      const dec = aesEcbDecrypt(TEST_KEY, result)
      expect(dec.substring(6, 8)).toBe(cmd)
    }
  })
})

describe('buildCommandWithParam', () => {
  it('places param byte after cmd', () => {
    const result = buildCommandWithParam(TEST_KEY, '06', 'AB', '12345678')
    const dec = aesEcbDecrypt(TEST_KEY, result)
    expect(dec.substring(6, 8)).toBe('06')
    expect(dec.substring(8, 10)).toBe('AB')
    expect(dec.endsWith('12345678')).toBe(true)
  })
})

describe('buildCommand3Params', () => {
  it('builds frame with 3 params and correct prefix', () => {
    const result = buildCommand3Params(TEST_KEY, '0D', 'AA', 'BB', 'CC', '12345678')
    const dec = aesEcbDecrypt(TEST_KEY, result)
    expect(dec.startsWith('7805C2')).toBe(true)
    expect(dec.substring(6, 8)).toBe('0D')
    expect(dec.substring(8, 10)).toBe('AA')
    expect(dec.substring(10, 12)).toBe('BB')
    expect(dec.substring(12, 14)).toBe('CC')
    expect(dec.endsWith('12345678')).toBe(true)
  })
})
