import { TailgBleConnection } from './ble/connection'
import { buildCommand } from './ble/protocol'
import { bytesToHex } from './utils/hex'
import { AES_KEYS, type CommandCode, type ModelType, type ParsedResponse } from './types'

const $ = (id: string) => document.getElementById(id)!

let conn: TailgBleConnection

function getSelectedKey(): string {
  const select = $('model-select') as HTMLSelectElement
  return AES_KEYS[select.value as ModelType]
}

function log(msg: string) {
  const el = $('log') as HTMLTextAreaElement
  const ts = new Date().toLocaleTimeString()
  el.value += `[${ts}] ${msg}\n`
  el.scrollTop = el.scrollHeight
}

function updateState() {
  const stateEl = $('conn-state')
  const stateMap = {
    disconnected: '未连接',
    connecting: '连接中...',
    connected: '已连接',
    authenticated: '已认证',
  }
  stateEl.textContent = stateMap[conn.state]
  stateEl.className = `state-${conn.state}`

  const nameEl = $('device-name')
  nameEl.textContent = conn.deviceName || '-'

  const tokenEl = $('token-val')
  tokenEl.textContent = conn.token || '-'

  const btns = document.querySelectorAll<HTMLButtonElement>('.cmd-btn')
  btns.forEach((btn) => (btn.disabled = conn.state !== 'authenticated'))
}

function handleResponse(resp: ParsedResponse) {
  log(`← 收到 [${resp.type}]: ${resp.raw}`)

  if (resp.type === 'voltage' && resp.voltage != null) {
    $('voltage-val').textContent = `${resp.voltage.toFixed(1)} V`
  }
  if (resp.type === 'state' && resp.bikeState) {
    $('lock-state').textContent = resp.bikeState.isLocked ? '已设防' : '已解防'
    $('power-state').textContent = resp.bikeState.isPowerOn ? '已上电' : '已断电'
  }
  if (resp.type === 'command') {
    const cmdNames: Record<string, string> = {
      '01': '设防', '02': '解防', '05': '开坐垫',
      '06': '上电', '07': '断电', '08': '寻车',
    }
    const name = cmdNames[resp.commandType ?? ''] ?? resp.commandType
    log(`  → ${name}: ${resp.success ? '成功' : '失败/超时'}`)
  }
}

async function sendCmd(cmd: CommandCode) {
  const data = buildCommand(getSelectedKey(), cmd, conn.token)
  log(`→ 发送指令 [${cmd}]: ${bytesToHex(data)}`)
  await conn.write(data)
}

function init() {
  conn = new TailgBleConnection(getSelectedKey())
  conn.onStateChange = updateState
  conn.onResponse = handleResponse
  conn.onLog = log

  $('btn-scan').addEventListener('click', async () => {
    try {
      conn.keyHex = getSelectedKey()
      await conn.scanAndConnect()
    } catch (e: any) {
      log(`连接失败: ${e.message}`)
    }
    updateState()
  })

  $('btn-scan-all').addEventListener('click', async () => {
    try {
      conn.keyHex = getSelectedKey()
      await conn.scanAll()
      await conn.connectToSelected()
    } catch (e: any) {
      log(`连接失败: ${e.message}`)
    }
    updateState()
  })

  $('btn-disconnect').addEventListener('click', () => {
    conn.disconnect()
    updateState()
  })

  ;($('model-select') as HTMLSelectElement).addEventListener('change', () => {
    conn.keyHex = getSelectedKey()
    log(`切换型号密钥: ${($('model-select') as HTMLSelectElement).value}`)
  })

  document.querySelectorAll<HTMLButtonElement>('.cmd-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd as CommandCode
      if (cmd) sendCmd(cmd)
    })
  })

  updateState()
}

document.addEventListener('DOMContentLoaded', init)
