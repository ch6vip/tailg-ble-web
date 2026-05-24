import { describe, it, expect } from 'vitest'
import { parseResponse } from '../ble/parser'
import { aesEcbEncrypt } from '../crypto/aes'

const TEST_KEY = '3A60432A5C01211F291E0F4E0C132825'

function makeEncrypted(plainHex: string): Uint8Array {
  return aesEcbEncrypt(TEST_KEY, plainHex)
}

describe('parseResponse', () => {
  describe('token response', () => {
    it('parses token from 78000000 prefix', () => {
      const data = makeEncrypted('78000000AABBCCDD0000000000000000')
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('token')
      expect(resp.token).toBe('AABBCCDD')
    })

    it('extracts 8-char token after prefix', () => {
      const data = makeEncrypted('7800000012345678FFFFFFFFFFFFFFFF')
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.token).toBe('12345678')
    })
  })

  describe('voltage response', () => {
    it('parses voltage from 780EB310 prefix', () => {
      const v = 5200
      const h = ((v >> 8) & 0xFF).toString(16).padStart(2, '0')
      const l = (v & 0xFF).toString(16).padStart(2, '0')
      const hex = '780EB310' + h + l + '00000000000000000000'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('voltage')
      expect(resp.voltage).toBeCloseTo(52.0, 1)
    })

    it('handles low voltage values', () => {
      const v = 4800
      const h = ((v >> 8) & 0xFF).toString(16).padStart(2, '0')
      const l = (v & 0xFF).toString(16).padStart(2, '0')
      const hex = ('780EB310' + h + l + '00000000000000000000').substring(0, 32)
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('voltage')
      expect(resp.voltage).toBeCloseTo(48.0, 1)
    })
  })

  describe('state response (0C)', () => {
    it('parses locked state (01)', () => {
      const hex = '7803C20C01000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('state')
      expect(resp.bikeState?.isLocked).toBe(true)
      expect(resp.bikeState?.isPowerOn).toBe(false)
    })

    it('parses power on state (03)', () => {
      const hex = '7803C20C03000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('state')
      expect(resp.bikeState?.isLocked).toBe(false)
      expect(resp.bikeState?.isPowerOn).toBe(true)
    })

    it('parses power on state (04)', () => {
      const hex = '7803C20C04000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.bikeState?.isPowerOn).toBe(true)
    })

    it('parses FF as failure', () => {
      const hex = '7803C20CFF000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('state')
      expect(resp.success).toBe(false)
    })
  })

  describe('command response', () => {
    it('parses successful command ack', () => {
      const hex = '7803C20100000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('command')
      expect(resp.commandType).toBe('01')
      expect(resp.success).toBe(true)
    })

    it('parses failed command (FF status)', () => {
      const hex = '7803C201FF000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.type).toBe('command')
      expect(resp.commandType).toBe('01')
      expect(resp.success).toBe(false)
    })

    it('parses unlock command ack', () => {
      const hex = '7803C20200000000000000000000ABCD'
      const data = makeEncrypted(hex)
      const resp = parseResponse(TEST_KEY, data)
      expect(resp.commandType).toBe('02')
      expect(resp.success).toBe(true)
    })
  })
})
