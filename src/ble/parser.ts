import { aesEcbDecrypt } from '../crypto/aes'
import type { ParsedResponse } from '../types'

const TOKEN_PREFIX = '78000000'
const VOLTAGE_PREFIX = '780EB310'

export function parseResponse(keyHex: string, raw: Uint8Array): ParsedResponse {
  const hex = aesEcbDecrypt(keyHex, raw)

  if (hex.startsWith(TOKEN_PREFIX)) {
    const token = hex.substring(8, 16)
    return { type: 'token', raw: hex, token }
  }

  if (hex.startsWith(VOLTAGE_PREFIX) && raw.length === 16) {
    const highByte = parseInt(hex.substring(8, 10), 16)
    const lowByte = parseInt(hex.substring(10, 12), 16)
    const voltage = ((highByte << 8) | lowByte) / 100.0
    return { type: 'voltage', raw: hex, voltage }
  }

  const controlCode = hex.substring(6, 10)
  const commandType = controlCode.substring(0, 2)
  const statusCode = controlCode.substring(2, 4)

  if (commandType === '0C') {
    const stateVal = statusCode
    if (stateVal === 'FF') {
      return { type: 'state', raw: hex, success: false }
    }
    const stateNum = parseInt(stateVal, 16)
    return {
      type: 'state',
      raw: hex,
      success: true,
      bikeState: {
        isLocked: stateNum === 1,
        isPowerOn: stateNum === 3 || stateNum === 4,
        voltage: null,
        batteryPercent: null,
        soc: false,
      },
    }
  }

  const success = statusCode !== 'FF'
  return { type: 'command', raw: hex, commandType, statusCode, success }
}
