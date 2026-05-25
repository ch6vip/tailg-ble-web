import type { CommandCode } from '../types'

export function buildQgjLoginFrame(password: string, userId: number): Uint8Array {
  const pwdNum = parseInt(password, 10)
  const payload = new Uint8Array(8)
  const view = new DataView(payload.buffer)
  view.setUint32(0, pwdNum, false)
  view.setUint32(4, userId, false)

  const cmdId = 0x1001
  const length = payload.length + 2 // payload + cmdID(2 bytes)

  const frame = new Uint8Array(4 + 2 + payload.length)
  frame[0] = 0xA7
  frame[1] = 0x00
  frame[2] = (length >> 8) & 0xFF
  frame[3] = length & 0xFF
  frame[4] = (cmdId >> 8) & 0xFF
  frame[5] = cmdId & 0xFF
  frame.set(payload, 6)

  return frame
}

export function buildQgjCommand(cmdId: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const length = payload.length + 2
  const frame = new Uint8Array(4 + 2 + payload.length)
  frame[0] = 0xA7
  frame[1] = 0x00
  frame[2] = (length >> 8) & 0xFF
  frame[3] = length & 0xFF
  frame[4] = (cmdId >> 8) & 0xFF
  frame[5] = cmdId & 0xFF
  frame.set(payload, 6)
  return frame
}

export function parseQgjResponse(data: Uint8Array): { cmdId: number; payload: Uint8Array; success: boolean } | null {
  if (data.length < 6 || data[0] !== 0xA7) return null
  const cmdId = (data[4] << 8) | data[5]
  const payload = data.slice(6)
  const statusNibble = (data[1] >> 4) & 0x0F
  return { cmdId, payload, success: statusNibble === 0 }
}

export const QGJ_CMD = {
  ECU_LOGIN: 0x1001,
  ECU_SET_STATUS: 0x1002,
} as const

const NOMAL_OPCODE: Partial<Record<CommandCode, number>> = {
  '01': 0x02, // DeviceSetSafe (lock)
  '02': 0x01, // DeviceOutSafe (unlock)
  '05': 0x07, // DeviceOpenSeat
  '06': 0x03, // DeviceOpenEleDoor (power on)
  '07': 0x04, // DeviceCloseEleDoor (power off)
  '08': 0x08, // DeviceFindBike
}

export function buildQgjControlFrame(cmd: CommandCode): Uint8Array | null {
  const opCode = NOMAL_OPCODE[cmd]
  if (opCode == null) return null
  return buildQgjCommand(QGJ_CMD.ECU_SET_STATUS, new Uint8Array([opCode]))
}
