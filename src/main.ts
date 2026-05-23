import { TailgBleConnection } from './ble/connection'
import { buildCommand } from './ble/protocol'
import { buildQgjLoginFrame } from './ble/qgj-protocol'
import { bytesToHex } from './utils/hex'
import { AES_KEYS, type CommandCode, type ModelType, type ParsedResponse } from './types'
import { getSmsCode, login, getCarStatus, sendCommand } from './cloud/api'
import type { CarInfo, CloudCmd } from './cloud/types'

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing DOM element #${id}`)
  return el
}
const MAX_LOG_LINES = 400

function initLock() {
  const saved = sessionStorage.getItem('unlocked')
  if (saved === '1') { unlock(); return }

  $('lock-btn').addEventListener('click', tryUnlock)
  $('lock-pwd').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') tryUnlock()
  })
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // PWA registration is best-effort; vehicle control must not depend on it.
    console.warn('Service worker registration failed')
  })
}

async function tryUnlock() {
  const pwd = ($('lock-pwd') as HTMLInputElement).value
  if (!pwd) return
  try {
    const resp = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    })
    const data = await resp.json()
    if (data.ok) {
      sessionStorage.setItem('unlocked', '1')
      unlock()
    } else {
      $('lock-error').classList.add('is-visible')
    }
  } catch {
    $('lock-error').classList.add('is-visible')
  }
}

function unlock() {
  $('lock-screen').classList.add('is-hidden')
  document.querySelector('.app')!.classList.remove('is-hidden')
}

let conn: TailgBleConnection
let cloudToken = ''
let selectedImei = ''
let activeChannel: 'cloud' | 'ble' = 'cloud'
let controlBusy = false
let debugBusy = false
const commandTimeouts: Partial<Record<'debug' | 'control', number>> = {}
const busyCommands: Partial<Record<'debug' | 'control', string>> = {}
type FeedbackMark = 'Idle' | 'Ready' | 'Hold' | 'TX' | 'OK' | 'Fail' | 'Timeout'
let currentFeedbackState: FeedbackMark = 'Idle'
let supportNotesChecked = false

const CMD_NAMES: Record<string, string> = {
  '01': '设防',
  '02': '解防',
  '05': '开坐垫',
  '06': '上电',
  '07': '断电',
  '08': '寻车',
  '0D': '状态帧',
  '0E': '防盗帧',
}

const DANGEROUS_COMMANDS = new Set<CommandCode>(['01', '07'])

function getSelectedKey(): string {
  const select = $('model-select') as HTMLSelectElement
  return AES_KEYS[select.value as ModelType]
}

function log(msg: string) {
  const el = $('log') as HTMLTextAreaElement
  const ts = new Date().toLocaleTimeString()
  const lines = el.value ? el.value.split('\n').filter(Boolean) : []
  lines.push(`[${ts}] ${msg}`)
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES)
  el.value = `${lines.join('\n')}\n`
  el.scrollTop = el.scrollHeight
}

function setFeedback(title: string, text: string, mark: FeedbackMark = 'Idle') {
  currentFeedbackState = mark
  const box = document.querySelector<HTMLElement>('.feedback')
  const titleEl = document.getElementById('command-feedback-title')
  const textEl = document.getElementById('command-feedback-text')
  const markEl = document.getElementById('command-feedback-mark')
  if (box) box.dataset.state = mark
  if (titleEl) titleEl.textContent = title
  if (textEl) textEl.textContent = text
  if (markEl) markEl.textContent = mark
}

function shouldRenderReadyFeedback() {
  return currentFeedbackState === 'Idle' || currentFeedbackState === 'Ready'
}

function resetFeedbackToAvailability() {
  currentFeedbackState = 'Idle'
  updateState()
}

function getControlStatus() {
  const cloudReady = !!cloudToken && !!selectedImei
  const bleReady = conn?.state === 'authenticated'
  const channel = activeChannel

  if (cloudReady && bleReady) {
    return {
      label: '双通道可用',
      detail: channel === 'cloud' ? '当前使用云端控车' : '当前使用蓝牙直连',
      online: true,
    }
  }
  if (cloudReady) {
    return {
      label: '云端已登录',
      detail: '当前使用云端控车',
      online: true,
    }
  }
  if (bleReady) {
    return {
      label: '蓝牙已认证',
      detail: '当前使用蓝牙直连',
      online: true,
    }
  }
  if (cloudToken && !selectedImei) {
    return {
      label: '云端待选车',
      detail: '请选择车辆后控车',
      online: false,
    }
  }
  if (channel === 'ble') {
    return {
      label: conn?.state === 'connecting' ? '蓝牙连接中' : '蓝牙未连接',
      detail: '连接车辆后即可控车',
      online: false,
    }
  }
  return {
    label: '云端未登录',
    detail: '登录或切换蓝牙后控车',
    online: false,
  }
}

function updateControlStatus() {
  const status = getControlStatus()
  const cloudState = document.getElementById('cloud-state')
  const cloudDot = document.getElementById('cloud-dot')
  const quickStatus = document.getElementById('quick-status')
  const floating = document.querySelector<HTMLElement>('.floating')
  if (cloudState) cloudState.textContent = status.label
  cloudDot?.classList.toggle('online', status.online)
  floating?.classList.toggle('is-online', status.online)
  if (quickStatus) quickStatus.textContent = status.detail
}

function updateCloudSessionView() {
  const loginForm = document.getElementById('cloud-login-form')
  const session = document.getElementById('cloud-session')
  const isLoggedIn = !!cloudToken
  loginForm?.classList.toggle('is-hidden', isLoggedIn)
  session?.classList.toggle('is-hidden', !isLoggedIn)
}

function updateSupportNotes() {
  if (supportNotesChecked) return
  supportNotesChecked = true
  const note = document.getElementById('ble-support-note')
  if (!note) return
  if (!('bluetooth' in navigator)) {
    note.textContent = '当前浏览器不支持 Web Bluetooth，请在安卓 Chrome/Edge 或 HTTPS 环境下使用蓝牙直连。'
    note.classList.remove('is-hidden')
    return
  }
  if (!window.isSecureContext) {
    note.textContent = '蓝牙直连需要 HTTPS 或 localhost 环境。'
    note.classList.remove('is-hidden')
    return
  }
  note.textContent = ''
  note.classList.add('is-hidden')
}

function getCommandGroup(cmd: string): 'debug' | 'control' {
  return cmd === '0D' || cmd === '0E' ? 'debug' : 'control'
}

function isGroupBusy(group: 'debug' | 'control') {
  return group === 'debug' ? debugBusy : controlBusy
}

function setGroupBusy(group: 'debug' | 'control', isBusy: boolean) {
  if (group === 'debug') debugBusy = isBusy
  else controlBusy = isBusy
}

function renderBusyClasses() {
  document.querySelectorAll<HTMLButtonElement>('.cmd-btn').forEach((btn) => {
    const group = getCommandGroup(btn.dataset.cmd ?? '')
    btn.classList.toggle('is-busy', !!busyCommands[group] && busyCommands[group] === btn.dataset.cmd)
  })
}

function setCommandBusy(isBusy: boolean, name = '') {
  const group = getCommandGroup(name)
  if (commandTimeouts[group] != null) {
    window.clearTimeout(commandTimeouts[group])
    commandTimeouts[group] = undefined
  }
  setGroupBusy(group, isBusy)
  busyCommands[group] = isBusy ? name : undefined
  renderBusyClasses()
  if (isBusy) {
    const label = CMD_NAMES[name] ?? name
    commandTimeouts[group] = window.setTimeout(() => {
      commandTimeouts[group] = undefined
      setGroupBusy(group, false)
      busyCommands[group] = undefined
      renderBusyClasses()
      updateState()
      setFeedback(`${label}执行超时`, '未在预期时间内收到回执，按钮已恢复，可检查链路后重试。', 'Timeout')
      log(`${label}执行超时，已恢复控车按钮`)
    }, 10000)
  }
  updateState()
}

function syncSummary() {
  const lockText = $('lock-state').textContent ?? '-'
  const powerText = $('power-state').textContent ?? '-'
  document.querySelectorAll('.mirror-lock').forEach((el) => { el.textContent = lockText })
  document.querySelectorAll('.mirror-power').forEach((el) => { el.textContent = powerText })
}

function setConnectionDrawer(open: boolean) {
  const drawer = document.getElementById('connection-drawer')
  const toggle = document.getElementById('connection-toggle')
  drawer?.classList.toggle('open', open)
  if (toggle) toggle.textContent = open ? '连接设置 收起' : '连接设置 展开'
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
  const canControl = activeChannel === 'cloud' ? !!cloudToken && !!selectedImei : conn.state === 'authenticated'
  btns.forEach((btn) => {
    const cmd = btn.dataset.cmd ?? ''
    const group = getCommandGroup(cmd)
    btn.disabled = !canControl || isGroupBusy(group)
  })
  if (!canControl && shouldRenderReadyFeedback()) {
    setFeedback('等待控车指令', '连接车辆或登录云端后即可使用常用控车。', 'Idle')
  } else if (!controlBusy && !debugBusy && shouldRenderReadyFeedback()) {
    setFeedback('控车已就绪', activeChannel === 'cloud' ? '当前指令将通过云端发送。' : '当前指令将通过蓝牙直连发送。', 'Ready')
  }
  syncSummary()
  updateControlStatus()
  updateCloudSessionView()
  updateSupportNotes()
}

function handleResponse(resp: ParsedResponse) {
  log(`← 收到 [${resp.type}]: ${resp.raw}`)

  if (resp.type === 'voltage' && resp.voltage != null) {
    $('voltage-val').textContent = `${resp.voltage.toFixed(1)} V`
  }
  if (resp.type === 'state' && resp.bikeState) {
    $('lock-state').textContent = resp.bikeState.isLocked ? '已设防' : '已解防'
    $('power-state').textContent = resp.bikeState.isPowerOn ? '已上电' : '已断电'
    syncSummary()
  }
  if (resp.type === 'command') {
    const name = CMD_NAMES[resp.commandType ?? ''] ?? resp.commandType
    log(`  → ${name}: ${resp.success ? '成功' : '失败/超时'}`)
    setCommandBusy(false, resp.commandType ?? '')
    setFeedback(
      resp.success ? `${name}执行成功` : `${name}执行失败`,
      resp.success ? '车辆已返回成功回执。' : '未收到成功回执，可检查链路后重试。',
      resp.success ? 'OK' : 'Fail',
    )
  }
}

async function sendCmd(cmd: CommandCode) {
  const name = CMD_NAMES[cmd] ?? cmd
  const data = buildCommand(getSelectedKey(), cmd, conn.token)
  log(`→ 发送指令 [${cmd}]: ${bytesToHex(data)}`)
  setCommandBusy(true, cmd)
  setFeedback('蓝牙指令发送中', `${name}命令已写入蓝牙链路，等待车辆回执。`, 'TX')
  try {
    await conn.write(data)
  } catch (e: any) {
    setCommandBusy(false, cmd)
    setFeedback('蓝牙指令发送失败', e.message, 'Fail')
    log(`蓝牙指令发送失败: ${e.message}`)
  }
}

const CMD_MAP: Record<string, CloudCmd> = {
  '01': 'lock', '02': 'unlock', '05': 'openCushion',
  '06': 'start', '07': 'stop', '08': 'search',
}

async function sendCloudCmd(cmd: CommandCode) {
  const cloudCmd = CMD_MAP[cmd]
  if (!cloudCmd) { log(`云端不支持指令: ${cmd}`); return }
  const name = CMD_NAMES[cmd] ?? cloudCmd
  try {
    log(`→ 云端指令: ${cloudCmd} (IMEI: ${selectedImei})`)
    setCommandBusy(true, cmd)
    setFeedback('云端指令发送中', `正在发送${name}，等待台铃云端响应。`, 'TX')
    const msg = await sendCommand(cloudToken, selectedImei, cloudCmd)
    log(`← 云端响应: ${msg}`)
    setCommandBusy(false, cmd)
    setFeedback('云端指令已返回', msg, 'OK')
  } catch (e: any) {
    log(`云端指令失败: ${e.message}`)
    setCommandBusy(false, cmd)
    setFeedback('云端指令失败', e.message, 'Fail')
  }
}

function clearCloudSession(reason?: string) {
  cloudToken = ''
  selectedImei = ''
  localStorage.removeItem('cloudToken')
  fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '' }),
  }).catch(() => {})
  $('car-list').innerHTML = ''
  if (reason) {
    log(reason)
    setFeedback('云端登录已失效', '请重新获取验证码并登录。', 'Fail')
  }
  updateState()
}

function armDangerousCommand(btn: HTMLButtonElement, cmd: CommandCode, run: () => Promise<void>) {
  let timer: number | undefined
  let armed = false
  let pointerId: number | undefined
  const originalText = btn.querySelector('.text')?.textContent ?? ''

  const reset = () => {
    if (timer != null) window.clearTimeout(timer)
    timer = undefined
    armed = false
    if (pointerId != null && btn.hasPointerCapture?.(pointerId)) {
      btn.releasePointerCapture(pointerId)
    }
    pointerId = undefined
    btn.classList.remove('is-holding')
    const text = btn.querySelector('.text')
    if (text) text.textContent = originalText
    if (currentFeedbackState === 'Hold') resetFeedbackToAvailability()
  }

  const start = (event: PointerEvent) => {
    if (btn.disabled || controlBusy) return
    event.preventDefault()
    pointerId = event.pointerId
    btn.setPointerCapture?.(event.pointerId)
    armed = true
    btn.classList.add('is-holding')
    const text = btn.querySelector('.text')
    if (text) text.textContent = '继续按住'
    setFeedback(`长按确认${CMD_NAMES[cmd]}`, '保持按住 1 秒执行危险动作，松开取消。', 'Hold')
    timer = window.setTimeout(async () => {
      if (!armed) return
      reset()
      await run()
    }, 1000)
  }

  btn.addEventListener('pointerdown', start)
  btn.addEventListener('pointerup', reset)
  btn.addEventListener('pointerleave', reset)
  btn.addEventListener('pointercancel', reset)
  btn.addEventListener('lostpointercapture', reset)
  btn.addEventListener('contextmenu', (event) => event.preventDefault())
  window.addEventListener('blur', reset)
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
    if (cloudToken && /token|登录|认证|授权|401|403|过期|失效/i.test(e.message)) {
      clearCloudSession('云端 token 已失效，已清理登录状态')
    }
  } finally {
    updateState()
  }
}

function buildCarInfoText(car: CarInfo): string {
  const defence = car.defenceStatus === '1' ? '已设防' : '已解防'
  const acc = car.acc === '1' ? '已上电' : '已断电'
  return `IMEI: ${car.imei} | ${defence} | ${acc} | 电量: ${car.electricQuantity || '-'}%`
}

function renderCarList(cars: CarInfo[]) {
  const container = $('car-list')
  container.innerHTML = ''
  if (!cars.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-note'
    empty.textContent = '当前账号暂无车辆，请确认手机号绑定车辆后重试。'
    container.appendChild(empty)
    return
  }
  for (const car of cars) {
    const div = document.createElement('div')
    div.className = 'car-item'
    div.dataset.imei = car.imei
    const name = document.createElement('div')
    name.className = 'car-name'
    name.textContent = car.carName || car.btname || car.imei
    const info = document.createElement('div')
    info.className = 'car-info'
    info.textContent = buildCarInfoText(car)
    div.append(name, info)
    div.addEventListener('click', () => selectCar(car))
    container.appendChild(div)
  }
}

function selectCar(car: CarInfo) {
  selectedImei = car.imei
  const title = document.getElementById('vehicle-title')
  if (title) title.textContent = car.carName || car.btname || '台铃智控车'
  document.querySelectorAll('.car-item').forEach(el => el.classList.remove('selected'))
  const items = document.querySelectorAll('.car-item')
  items.forEach(el => {
    if ((el as HTMLElement).dataset.imei === car.imei) el.classList.add('selected')
  })
  $('lock-state').textContent = car.defenceStatus === '1' ? '已设防' : '已解防'
  $('power-state').textContent = car.acc === '1' ? '已上电' : '已断电'
  $('battery-val').textContent = car.electricQuantity ? `${car.electricQuantity}%` : '-'
  $('voltage-val').textContent = car.voltage ? `${car.voltage}V` : '-'
  syncSummary()
  log(`选中车辆: ${car.carName || car.imei}`)
  updateState()
}

function init() {
  initLock()
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
    const run = async () => {
      try {
        const cmd = btn.dataset.cmd as CommandCode
        if (!cmd) return
        if (isGroupBusy(getCommandGroup(cmd))) return
        if (activeChannel === 'cloud' && selectedImei) {
          await sendCloudCmd(cmd)
        } else {
          await sendCmd(cmd)
        }
      } catch (e: any) {
        setCommandBusy(false, btn.dataset.cmd ?? '')
        log(`指令执行异常: ${e.message}`)
        setFeedback('指令执行异常', e.message || '请检查连接后重试。', 'Fail')
      }
    }
    const cmd = btn.dataset.cmd as CommandCode
    if (DANGEROUS_COMMANDS.has(cmd)) {
      armDangerousCommand(btn, cmd, run)
    } else {
      btn.addEventListener('click', run)
    }
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
      localStorage.setItem('cloudToken', cloudToken)
      fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cloudToken }),
      }).catch(() => {})
      log('登录成功')
      activeChannel = 'cloud'
      await loadCars()
    } catch (e: any) {
      log(`登录失败: ${e.message}`)
    }
  })

  $('btn-cloud-logout').addEventListener('click', () => {
    clearCloudSession()
    log('已退出云端登录')
  })

  // --- Tabs ---
  const tabs = { cloud: $('tab-cloud'), ble: $('tab-ble') }
  const panels = { cloud: $('panel-cloud'), ble: $('panel-ble') }
  function switchTab(t: 'cloud' | 'ble') {
    Object.entries(tabs).forEach(([k, el]) => el.classList.toggle('active', k === t))
    Object.entries(panels).forEach(([k, el]) => (el as HTMLElement).classList.toggle('active', k === t))
    activeChannel = t
    setConnectionDrawer(true)
    updateState()
  }
  tabs.cloud.addEventListener('click', () => switchTab('cloud'))
  tabs.ble.addEventListener('click', () => switchTab('ble'))

  // --- 恢复登录状态 ---
  const savedToken = localStorage.getItem('cloudToken')
  if (savedToken) {
    cloudToken = savedToken
    activeChannel = 'cloud'
    loadCars()
  } else {
    fetch('/api/token').then(r => r.json()).then(d => {
      if (d.token) {
        cloudToken = d.token
        localStorage.setItem('cloudToken', d.token)
        activeChannel = 'cloud'
        loadCars()
      }
    }).catch(() => {})
  }

  // --- Advanced panel ---
  $('advanced-toggle').addEventListener('click', () => {
    const panel = $('advanced-panel')
    const willOpen = !panel.classList.contains('is-open')
    panel.classList.toggle('is-open', willOpen)
    $('advanced-toggle').textContent = willOpen ? '工程调试面板 收起' : '工程调试面板 展开'
  })

  document.getElementById('drawer-debug-link')?.addEventListener('click', () => {
    const panel = $('advanced-panel')
    panel.classList.add('is-open')
    $('advanced-toggle').textContent = '工程调试面板 收起'
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  document.getElementById('connection-toggle')?.addEventListener('click', () => {
    const drawer = document.getElementById('connection-drawer')
    setConnectionDrawer(!drawer?.classList.contains('open'))
  })

  document.getElementById('quick-connect')?.addEventListener('click', () => {
    setConnectionDrawer(true)
    document.getElementById('connection-toggle')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  updateState()
}

document.addEventListener('DOMContentLoaded', init)
registerServiceWorker()
