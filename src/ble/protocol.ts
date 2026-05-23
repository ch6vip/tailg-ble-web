import { aesEcbEncrypt } from '../crypto/aes'
import type { CommandCode } from '../types'

const TOKEN_REQUEST_PLAINTEXT = '780000002D1A683D48271A18316E471A'

export function buildTokenRequest(keyHex: string): Uint8Array {
  return aesEcbEncrypt(keyHex, TOKEN_REQUEST_PLAINTEXT)
}

export function buildCommand(keyHex: string, cmd: CommandCode, token: string): Uint8Array {
  const frame = '7803C2' + cmd + '00' + '11111111111111' + token
  return aesEcbEncrypt(keyHex, frame)
}

export function buildCommandWithParam(
  keyHex: string,
  cmd: CommandCode,
  param: string,
  token: string
): Uint8Array {
  const frame = '7803C2' + cmd + param + '11111111111111' + token
  return aesEcbEncrypt(keyHex, frame)
}

export function buildCommand3Params(
  keyHex: string,
  cmd: CommandCode,
  p1: string,
  p2: string,
  p3: string,
  token: string
): Uint8Array {
  const frame = '7805C2' + cmd + p1 + p2 + p3 + '1111111111' + token
  return aesEcbEncrypt(keyHex, frame)
}
