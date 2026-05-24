import { describe, it, expect } from 'vitest'
import { hexToBytes, bytesToHex, intToHex2 } from '../utils/hex'

describe('hexToBytes', () => {
  it('converts hex string to Uint8Array', () => {
    expect(hexToBytes('00FF')).toEqual(new Uint8Array([0x00, 0xFF]))
    expect(hexToBytes('1AF78CD3')).toEqual(new Uint8Array([0x1A, 0xF7, 0x8C, 0xD3]))
  })

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]))
  })

  it('handles lowercase hex', () => {
    expect(hexToBytes('abcd')).toEqual(new Uint8Array([0xAB, 0xCD]))
  })
})

describe('bytesToHex', () => {
  it('converts Uint8Array to uppercase hex string', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0xFF]))).toBe('00FF')
    expect(bytesToHex(new Uint8Array([0x1A, 0xF7, 0x8C, 0xD3]))).toBe('1AF78CD3')
  })

  it('handles empty array', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('')
  })
})

describe('intToHex2', () => {
  it('converts number to 2-char uppercase hex', () => {
    expect(intToHex2(0)).toBe('00')
    expect(intToHex2(255)).toBe('FF')
    expect(intToHex2(16)).toBe('10')
  })

  it('masks to single byte', () => {
    expect(intToHex2(256)).toBe('00')
    expect(intToHex2(257)).toBe('01')
  })
})

describe('roundtrip', () => {
  it('hexToBytes -> bytesToHex preserves data', () => {
    const hex = '3A60432A5C01211F291E0F4E0C132825'
    expect(bytesToHex(hexToBytes(hex))).toBe(hex)
  })
})
