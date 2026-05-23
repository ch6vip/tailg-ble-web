import aesjs from 'aes-js'
import { hexToBytes, bytesToHex } from '../utils/hex'

export function aesEcbEncrypt(keyHex: string, dataHex: string): Uint8Array {
  const key = hexToBytes(keyHex)
  const data = hexToBytes(dataHex)
  const ecb = new aesjs.ModeOfOperation.ecb(key)
  return new Uint8Array(ecb.encrypt(data))
}

export function aesEcbDecrypt(keyHex: string, data: Uint8Array): string {
  const key = hexToBytes(keyHex)
  const ecb = new aesjs.ModeOfOperation.ecb(key)
  const decrypted = new Uint8Array(ecb.decrypt(data))
  return bytesToHex(decrypted)
}
