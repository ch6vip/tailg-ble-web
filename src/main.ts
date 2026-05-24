import { TailgBleConnection } from './ble/connection'
import { buildQgjLoginFrame } from './ble/qgj-protocol'
import { bytesToHex } from './utils/hex'
import { type CommandCode, type ParsedResponse } from './types'
import { getSmsCode, login, getCarStatus } from './cloud/api'
import { persistToken } from './cloud/token'
import { getCommandImei, type CarInfo } from './cloud/types'
import { $, errMsg, log } from './dom'
import { initLock } from './ui/lock'
import { renderCarList, selectCarUI } from './ui/cars'
import { setFeedback, shouldRenderReadyFeedback, resetFeedbackState, getFeedbackState } from './ui/feedback'
import { getState, setState, subscribe } from './state'
import {
  CMD_NAMES, DANGEROUS_COMMANDS, getCommandGroup, getBusyCommand,
  getSelectedKey, setCommandBusy, executeCommand,
} from './commands'

let conn: TailgBleConnection
let supportNotesChecked = false

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return
  navigator.serviceWorker.register('/sw.js').catch(() => {
    console.warn('Service worker registration failed')
  })
}

function updateControlStatus() {
  const { cloudToken, selectedCar, activeChannel, bleState } = getState()
  const cloudReady = !!cloudToken && !!selectedCar
  const bleReady = bleState === 'authenticated'
  const vehicleOnline = selectedCar?.online === true

  let label: string, online: boolean
  if (cloudReady || bleReady) {
    label = vehicleOnline ? '在线' : '就绪'
    online = true
  } else if (cloudToken && !selectedCar) {
    label = '待选车'
    online = false
  } else if (activeChannel === 'ble') {
    label = bleState === 'connecting' ? '连接中' : '离线'
    online = false
  } else {
    label = '离线'
    online = false
  }

  const cloudState = document.getElementById('cloud-state')
  const cloudDot = document.getElementById('cloud-dot')
  if (cloudState) cloudState.textContent = label
  cloudDot?.classList.toggle('online', online)
}

function updateCloudSessionView() {
  const { cloudToken, selectedCar } = getState()
  const loginForm = document.getElementById('cloud-login-form')
  const session = document.getElementById('cloud-session')
  const isLoggedIn = !!cloudToken
  loginForm?.classList.toggle('is-hidden', isLoggedIn)
  session?.classList.toggle('is-hidden', !isLoggedIn)
  const sessionText = session?.querySelector('span')
  if (sessionText && isLoggedIn) {
    sessionText.textContent = selectedCar
      ? `已连接：${selectedCar.carNickName || selectedCar.carName || selectedCar.imei}`
      : '云端已登录，请选择车辆后控车。'
  }
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

function renderBusyClasses() {
  document.querySelectorAll<HTMLButtonElement>('.cmd-btn').forEach((btn) => {
    const group = getCommandGroup(btn.dataset.cmd ?? '')
    const busyCmd = getBusyCommand(group)
    btn.classList.toggle('is-busy', !!busyCmd && busyCmd === btn.dataset.cmd)
  })
}

function updateBleInfo() {
  const { bleDeviceName, bleToken } = getState()
  $('device-name').textContent = bleDeviceName || '-'
  $('token-val').textContent = bleToken || '-'
}

function updateButtons() {
  const { activeChannel, cloudToken, selectedCar, bleState, controlBusy, debugBusy } = getState()
  const canControl = activeChannel === 'cloud' ? !!cloudToken && !!selectedCar : bleState === 'authenticated'
  document.querySelectorAll<HTMLButtonElement>('.cmd-btn').forEach((btn) => {
    const cmd = btn.dataset.cmd ?? ''
    const group = getCommandGroup(cmd)
    btn.disabled = !canControl || (group === 'debug' ? debugBusy : controlBusy)
  })
  if (!canControl && shouldRenderReadyFeedback()) {
    setFeedback('等待控车指令', '连接车辆或登录云端后即可使用常用控车。', 'Idle')
  } else if (!controlBusy && !debugBusy && shouldRenderReadyFeedback()) {
    setFeedback('控车已就绪', activeChannel === 'cloud' ? '当前指令将通过云端发送。' : '当前指令将通过蓝牙直连发送。', 'Ready')
  }
}

function syncSummary() {
  const { defenceState, powerState } = getState()
  const defenceEl = document.getElementById('hero-defence-text')
  const powerEl = document.getElementById('hero-power-text')
  if (defenceEl) defenceEl.textContent = defenceState
  if (powerEl) powerEl.textContent = powerState
}

// PLACEHOLDER_MAIN_PART2

function setConnectionDrawer(open: boolean) {
  const drawer = document.getElementById('connection-drawer')
  const toggle = document.getElementById('connection-toggle')
  drawer?.classList.toggle('open', open)
  if (toggle) toggle.textContent = open ? '连接设置 收起' : '连接设置 展开'
}

function handleResponse(resp: ParsedResponse) {
  log(`← 收到 [${resp.type}]: ${resp.raw}`)

  if (resp.type === 'voltage' && resp.voltage != null) {
    const heroVoltage = document.getElementById('hero-voltage-val')
    if (heroVoltage) heroVoltage.textContent = `${resp.voltage.toFixed(1)}V`
  }
  if (resp.type === 'state' && resp.bikeState) {
    setState({
      defenceState: resp.bikeState.isLocked ? '已设防' : '已解防',
      powerState: resp.bikeState.isPowerOn ? '已上电' : '已断电',
    })
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

function clearCloudSession(reason?: string) {
  setState({ cloudToken: '', selectedCar: null })
  persistToken('')
  $('car-list').innerHTML = ''
  if (reason) {
    log(reason)
    setFeedback('云端登录已失效', '请重新获取验证码并登录。', 'Fail')
  }
}

async function loadCars() {
  const { cloudToken } = getState()
  try {
    log('获取车辆列表...')
    const cars = await getCarStatus(cloudToken)
    log(`找到 ${cars.length} 辆车`)
    renderCarList(cars, selectCar)
    if (cars.length === 1) selectCar(cars[0])
  } catch (e: unknown) {
    const msg = errMsg(e)
    log(`获取车辆失败: ${msg}`)
    if (cloudToken && /token|登录|认证|授权|401|403|过期|失效/i.test(msg)) {
      clearCloudSession('云端 token 已失效，已清理登录状态')
    }
  }
}

function selectCar(car: CarInfo) {
  const uiState = selectCarUI(car)
  setState({
    selectedCar: car,
    defenceState: uiState.defence,
    powerState: uiState.power,
  })
  const photo = document.getElementById('car-photo') as HTMLImageElement | null
  if (photo && car.carPhoto) photo.src = car.carPhoto
  log(`选中车辆: ${car.carNickName || car.carName || car.imei} (指令IMEI: ${getCommandImei(car)}, modelType: ${car.modelType})`)
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
    if (getFeedbackState() === 'Hold') {
      resetFeedbackState()
      updateButtons()
    }
  }

  const start = (event: PointerEvent) => {
    if (btn.disabled || getState().controlBusy) return
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

// PLACEHOLDER_MAIN_INIT

function init() {
  initLock()
  conn = new TailgBleConnection(getSelectedKey())
  conn.onStateChange = () => {
    setState({ bleState: conn.state, bleToken: conn.token, bleDeviceName: conn.deviceName })
  }
  conn.onResponse = handleResponse
  conn.onLog = log

  subscribe((_state, changed) => {
    if (changed.has('bleState') || changed.has('bleToken') || changed.has('bleDeviceName')) updateBleInfo()
    if (changed.has('controlBusy') || changed.has('debugBusy') || changed.has('bleState') ||
        changed.has('cloudToken') || changed.has('selectedCar') || changed.has('activeChannel')) {
      updateButtons()
      renderBusyClasses()
    }
    if (changed.has('defenceState') || changed.has('powerState')) syncSummary()
    if (changed.has('cloudToken') || changed.has('selectedCar') || changed.has('activeChannel') ||
        changed.has('bleState')) updateControlStatus()
    if (changed.has('cloudToken') || changed.has('selectedCar')) updateCloudSessionView()
  })

  $('btn-scan').addEventListener('click', async () => {
    try {
      conn.keyHex = getSelectedKey()
      await conn.scanAndConnect()
    } catch (e: unknown) {
      log(`连接失败: ${errMsg(e)}`)
    }
  })

  $('btn-scan-all').addEventListener('click', async () => {
    try {
      conn.keyHex = getSelectedKey()
      await conn.scanAll()
      await conn.connectToSelected()
    } catch (e: unknown) {
      log(`连接失败: ${errMsg(e)}`)
    }
  })

  $('btn-diagnose').addEventListener('click', async () => {
    try {
      conn.keyHex = getSelectedKey()
      await conn.scanAll()
      await conn.diagnose()
    } catch (e: unknown) {
      log(`诊断失败: ${errMsg(e)}`)
    }
  })

  $('btn-disconnect').addEventListener('click', () => {
    conn.disconnect()
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
        await executeCommand(conn, cmd)
      } catch (e: unknown) {
        setCommandBusy(false, btn.dataset.cmd ?? '')
        const msg = errMsg(e)
        log(`指令执行异常: ${msg}`)
        setFeedback('指令执行异常', msg || '请检查连接后重试。', 'Fail')
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

  $('btn-get-code').addEventListener('click', async () => {
    const phone = ($('phone-input') as HTMLInputElement).value.trim()
    if (!phone) { log('请输入手机号'); return }
    try {
      log(`获取验证码: ${phone}`)
      await getSmsCode(phone)
      log('验证码已发送')
    } catch (e: unknown) {
      log(`获取验证码失败: ${errMsg(e)}`)
    }
  })

  $('btn-cloud-login').addEventListener('click', async () => {
    const phone = ($('phone-input') as HTMLInputElement).value.trim()
    const sms = ($('sms-input') as HTMLInputElement).value.trim()
    if (!phone || !sms) { log('请输入手机号和验证码'); return }
    try {
      log('正在登录...')
      const token = await login(phone, sms)
      setState({ cloudToken: token, activeChannel: 'cloud' })
      persistToken(token)
      log('登录成功')
      await loadCars()
    } catch (e: unknown) {
      log(`登录失败: ${errMsg(e)}`)
    }
  })

  $('btn-cloud-logout').addEventListener('click', () => {
    clearCloudSession()
    log('已退出云端登录')
  })

  const tabs = { cloud: $('tab-cloud'), ble: $('tab-ble') }
  const panels = { cloud: $('panel-cloud'), ble: $('panel-ble') }
  function switchTab(t: 'cloud' | 'ble') {
    Object.entries(tabs).forEach(([k, el]) => el.classList.toggle('active', k === t))
    Object.entries(panels).forEach(([k, el]) => (el as HTMLElement).classList.toggle('active', k === t))
    setState({ activeChannel: t })
    setConnectionDrawer(true)
  }
  tabs.cloud.addEventListener('click', () => switchTab('cloud'))
  tabs.ble.addEventListener('click', () => switchTab('ble'))

  const savedToken = localStorage.getItem('cloudToken')
  if (savedToken) {
    setState({ cloudToken: savedToken, activeChannel: 'cloud' })
    loadCars()
  } else {
    fetch('/api/token', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return
      if (d.token) {
        setState({ cloudToken: d.token, activeChannel: 'cloud' })
        localStorage.setItem('cloudToken', d.token)
        loadCars()
      }
    }).catch(() => {})
  }

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

  updateSupportNotes()
  updateBleInfo()
  updateButtons()
  syncSummary()
  updateControlStatus()
  updateCloudSessionView()
}

document.addEventListener('DOMContentLoaded', init)
registerServiceWorker()
