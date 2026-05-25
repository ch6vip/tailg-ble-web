import { TailgBleConnection } from './ble/connection'
import { buildCommand } from './ble/protocol'
import { buildQgjControlFrame } from './ble/qgj-protocol'
import { bytesToHex } from './utils/hex'
import { AES_KEYS, type CommandCode, type ModelType } from './types'
import { sendCommand } from './cloud/api'
import { getCommandImei, type CloudCmd } from './cloud/types'
import { getState, setState } from './state'
import { errMsg, log } from './dom'
import { setFeedback } from './ui/feedback'

export const CMD_NAMES: Record<string, string> = {
  '01': '设防',
  '02': '解防',
  '05': '开坐垫',
  '06': '上电',
  '07': '断电',
  '08': '寻车',
  '0D': '状态帧',
  '0E': '防盗帧',
}

export const DANGEROUS_COMMANDS = new Set<CommandCode>(['01', '07'])

const CMD_MAP: Record<string, CloudCmd> = {
  '01': 'lock', '02': 'unlock', '05': 'openCushion',
  '06': 'start', '07': 'stop', '08': 'search',
}

const commandTimeouts: Partial<Record<'debug' | 'control', number>> = {}
const busyCommands: Partial<Record<'debug' | 'control', string>> = {}

export function getCommandGroup(cmd: string): 'debug' | 'control' {
  return cmd === '0D' || cmd === '0E' ? 'debug' : 'control'
}

export function getBusyCommand(group: 'debug' | 'control'): string | undefined {
  return busyCommands[group]
}

export function getSelectedKey(): string {
  const select = document.getElementById('model-select') as HTMLSelectElement
  return AES_KEYS[select.value as ModelType]
}

export function setCommandBusy(isBusy: boolean, cmd = '') {
  const group = getCommandGroup(cmd)
  if (commandTimeouts[group] != null) {
    window.clearTimeout(commandTimeouts[group])
    commandTimeouts[group] = undefined
  }
  const stateUpdate = group === 'debug'
    ? { debugBusy: isBusy }
    : { controlBusy: isBusy }
  busyCommands[group] = isBusy ? cmd : undefined
  setState(stateUpdate)

  if (isBusy) {
    const label = CMD_NAMES[cmd] ?? cmd
    commandTimeouts[group] = window.setTimeout(() => {
      commandTimeouts[group] = undefined
      busyCommands[group] = undefined
      setState(group === 'debug' ? { debugBusy: false } : { controlBusy: false })
      setFeedback(`${label}执行超时`, '未在预期时间内收到回执，按钮已恢复，可检查链路后重试。', 'Timeout')
      log(`${label}执行超时，已恢复控车按钮`)
    }, 10000)
  }
}

export async function sendBleCmd(conn: TailgBleConnection, cmd: CommandCode) {
  if (conn.serviceType === 'fcc0') {
    await sendQgjCmd(conn, cmd)
    return
  }
  const name = CMD_NAMES[cmd] ?? cmd
  const data = buildCommand(getSelectedKey(), cmd, conn.token)
  log(`→ 发送指令 [${cmd}]: ${bytesToHex(data)}`)
  setCommandBusy(true, cmd)
  setFeedback('蓝牙指令发送中', `${name}命令已写入蓝牙链路，等待车辆回执。`, 'TX')
  try {
    await conn.write(data)
  } catch (e: unknown) {
    const msg = errMsg(e)
    setCommandBusy(false, cmd)
    setFeedback('蓝牙指令发送失败', msg, 'Fail')
    log(`蓝牙指令发送失败: ${msg}`)
  }
}

async function sendQgjCmd(conn: TailgBleConnection, cmd: CommandCode) {
  const name = CMD_NAMES[cmd] ?? cmd
  const frame = buildQgjControlFrame(cmd)
  if (!frame) {
    log(`QGJ 不支持指令: ${cmd}`)
    setFeedback(`${name}指令不支持`, 'QGJ 协议下该指令未映射，请改走云端通道。', 'Fail')
    return
  }
  log(`→ [QGJ] ${name} [${cmd}]: ${bytesToHex(frame)}`)
  setCommandBusy(true, cmd)
  setFeedback('QGJ 指令发送中', `${name}已写入 feb1，等待 feb2 回执。`, 'TX')
  try {
    const ackPromise = conn.awaitQgjAck()
    await conn.writeRaw('feb1', bytesToHex(frame))
    const ack = await ackPromise
    setCommandBusy(false, cmd)
    setFeedback(
      ack.success ? `${name}执行成功` : `${name}执行失败`,
      ack.success ? '车辆已返回成功回执。' : '未收到成功回执，可检查链路后重试。',
      ack.success ? 'OK' : 'Fail',
    )
    const updates: Partial<{ defenceState: string; powerState: string }> = {}
    if (ack.success) {
      if (cmd === '01') updates.defenceState = '已设防'
      else if (cmd === '02') updates.defenceState = '已解防'
      else if (cmd === '06') updates.powerState = '已上电'
      else if (cmd === '07') updates.powerState = '已断电'
    }
    if (Object.keys(updates).length) setState(updates)
  } catch (e: unknown) {
    const msg = errMsg(e)
    setCommandBusy(false, cmd)
    setFeedback('QGJ 指令写入失败', msg, 'Fail')
    log(`QGJ 指令写入失败: ${msg}`)
  }
}

export async function sendCloudCmd(cmd: CommandCode) {
  const { cloudToken, selectedCar } = getState()
  const cloudCmd = CMD_MAP[cmd]
  if (!cloudCmd) { log(`云端不支持指令: ${cmd}`); return }
  const name = CMD_NAMES[cmd] ?? cloudCmd
  const imei = getCommandImei(selectedCar!)
  try {
    log(`→ 云端指令: ${cloudCmd} (IMEI: ${imei})`)
    setCommandBusy(true, cmd)
    setFeedback('云端指令发送中', `正在发送${name}，等待台铃云端响应。`, 'TX')
    const msg = await sendCommand(cloudToken, imei, cloudCmd)
    log(`← 云端响应: ${msg}`)
    setCommandBusy(false, cmd)
    setFeedback('云端指令已返回', msg, 'OK')
    const updates: Partial<{ defenceState: string; powerState: string }> = {}
    if (cmd === '01') updates.defenceState = '已设防'
    else if (cmd === '02') updates.defenceState = '已解防'
    else if (cmd === '06') updates.powerState = '已上电'
    else if (cmd === '07') updates.powerState = '已断电'
    if (Object.keys(updates).length) setState(updates)
  } catch (e: unknown) {
    const msg = errMsg(e)
    log(`云端指令失败: ${msg}`)
    setCommandBusy(false, cmd)
    setFeedback('云端指令失败', msg, 'Fail')
  }
}

export async function executeCommand(conn: TailgBleConnection, cmd: CommandCode) {
  const { activeChannel, selectedCar, controlBusy, debugBusy } = getState()
  const group = getCommandGroup(cmd)
  if (group === 'debug' ? debugBusy : controlBusy) return

  if (activeChannel === 'cloud' && selectedCar) {
    await sendCloudCmd(cmd)
  } else {
    await sendBleCmd(conn, cmd)
  }
}
