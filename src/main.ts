import { TailgBleConnection } from './ble/connection'
import { buildCommand } from './ble/protocol'
import { buildQgjLoginFrame } from './ble/qgj-protocol'
import { bytesToHex } from './utils/hex'
import { AES_KEYS, type CommandCode, type ModelType, type ParsedResponse } from './types'
import { getSmsCode, login, getCarStatus, sendCommand } from './cloud/api'
import type { CarInfo, CloudCmd } from './cloud/types'

const $ = (id: string) => document.getElementById(id)!

let conn: TailgBleConnection
let cloudToken = ''
let selectedImei = ''
let cloudMode = false

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
  const canControl = cloudMode ? !!selectedImei : conn.state === 'authenticated'
  btns.forEach((btn) => (btn.disabled = !canControl))
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

const CMD_MAP: Record<string, CloudCmd> = {
  '01': 'lock', '02': 'unlock', '05': 'openCushion',
  '06': 'start', '07': 'stop', '08': 'search',
}

async function sendCloudCmd(cmd: CommandCode) {
  const cloudCmd = CMD_MAP[cmd]
  if (!cloudCmd) { log(`云端不支持指令: ${cmd}`); return }
  try {
    log(`→ 云端指令: ${cloudCmd} (IMEI: ${selectedImei})`)
    const msg = await sendCommand(cloudToken, selectedImei, cloudCmd)
    log(`← 云端响应: ${msg}`)
  } catch (e: any) {
    log(`云端指令失败: ${e.message}`)
  }
}

async function loadCars() {
  try {
    log('获取车辆列表...')
    const cars = await getCarStatus(cloudToken)
    log(`找到 ${cars.length} 辆车`)
    renderCarList(cars)
    if (cars.length === 1) selectCar(cars[0])
  } catch (e: any) {
    log(`获取车辆失败: ${e.message}`)
  }
}

function renderCarList(cars: CarInfo[]) {
  const container = $('car-list')
  container.innerHTML = ''
  for (const car of cars) {
    const div = document.createElement('div')
    div.className = 'car-item'
    div.innerHTML = `<div class="car-name">${car.carName || car.btname || car.imei}</div>
      <div class="car-info">IMEI: ${car.imei} | ${car.defenceStatus === '1' ? '已设防' : '已解防'} | ${car.acc === '1' ? '已上电' : '已断电'} | 电量: ${car.electricQuantity || '-'}%</div>`
    div.addEventListener('click', () => selectCar(car))
    container.appendChild(div)
  }
}

function selectCar(car: CarInfo) {
  selectedImei = car.imei
  document.querySelectorAll('.car-item').forEach(el => el.classList.remove('selected'))
  const items = document.querySelectorAll('.car-item')
  items.forEach(el => {
    if (el.querySelector('.car-info')?.textContent?.includes(car.imei)) el.classList.add('selected')
  })
  $('lock-state').textContent = car.defenceStatus === '1' ? '已设防' : '已解防'
  $('power-state').textContent = car.acc === '1' ? '已上电' : '已断电'
  $('battery-val').textContent = car.electricQuantity ? `${car.electricQuantity}%` : '-'
  $('voltage-val').textContent = car.voltage ? `${car.voltage}V` : '-'
  log(`选中车辆: ${car.carName || car.imei}`)
  updateState()
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

  $('btn-diagnose').addEventListener('click', async () => {
    try {
      conn.keyHex = getSelectedKey()
      await conn.scanAll()
      await conn.diagnose()
    } catch (e: any) {
      log(`诊断失败: ${e.message}`)
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
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd as CommandCode
      if (!cmd) return
      if (cloudMode && selectedImei) {
        await sendCloudCmd(cmd)
      } else {
        sendCmd(cmd)
      }
    })
  })

  $('btn-copy-log').addEventListener('click', async () => {
    const el = $('log') as HTMLTextAreaElement
    const text = el.value
    if (!text) return
    const btn = $('btn-copy-log') as HTMLButtonElement
    const original = btn.textContent
    try {
      await navigator.clipboard.writeText(text)
      btn.textContent = '已复制'
    } catch {
      el.select()
      document.execCommand('copy')
      btn.textContent = '已复制'
    }
    setTimeout(() => { btn.textContent = original }, 1500)
  })

  $('btn-clear-log').addEventListener('click', () => {
    ;($('log') as HTMLTextAreaElement).value = ''
  })

  $('btn-send-raw').addEventListener('click', async () => {
    const charId = ($('char-select') as HTMLSelectElement).value
    const hex = ($('hex-input') as HTMLInputElement).value.replace(/\s/g, '')
    if (!hex) return
    await conn.writeRaw(charId, hex)
  })

  $('btn-qgj-login').addEventListener('click', async () => {
    const loginFrame = buildQgjLoginFrame('000000000', 0)
    log(`尝试 QGJ 登录 (pwd=0, uid=0): ${bytesToHex(loginFrame)}`)
    await conn.writeRaw('fe02', bytesToHex(loginFrame))
  })

  // --- 云端控车 ---
  $('btn-get-code').addEventListener('click', async () => {
    const phone = ($('phone-input') as HTMLInputElement).value.trim()
    if (!phone) { log('请输入手机号'); return }
    try {
      log(`获取验证码: ${phone}`)
      await getSmsCode(phone)
      log('验证码已发送')
    } catch (e: any) {
      log(`获取验证码失败: ${e.message}`)
    }
  })

  $('btn-cloud-login').addEventListener('click', async () => {
    const phone = ($('phone-input') as HTMLInputElement).value.trim()
    const sms = ($('sms-input') as HTMLInputElement).value.trim()
    if (!phone || !sms) { log('请输入手机号和验证码'); return }
    try {
      log('正在登录...')
      cloudToken = await login(phone, sms)
      log('登录成功')
      $('cloud-state').textContent = '已登录'
      $('cloud-state').style.color = '#00ff88'
      $('btn-cloud-login').style.display = 'none'
      $('btn-cloud-logout').style.display = ''
      cloudMode = true
      await loadCars()
    } catch (e: any) {
      log(`登录失败: ${e.message}`)
    }
  })

  $('btn-cloud-logout').addEventListener('click', () => {
    cloudToken = ''
    selectedImei = ''
    cloudMode = false
    $('cloud-state').textContent = '未登录'
    $('cloud-state').style.color = '#888'
    $('btn-cloud-login').style.display = ''
    $('btn-cloud-logout').style.display = 'none'
    $('car-list').innerHTML = ''
    updateState()
    log('已退出云端登录')
  })

  updateState()
}

document.addEventListener('DOMContentLoaded', init)
