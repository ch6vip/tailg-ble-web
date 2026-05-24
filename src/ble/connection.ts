import {
  BLE_SERVICE_UUID, BLE_SERVICE_FCC0,
  BLE_WRITE_UUID, BLE_NOTIFY_UUID,
  BLE_FCC1_UUID, BLE_FBB1_UUID,
  ALL_SERVICE_UUIDS,
} from '../types'
import { buildTokenRequest } from './protocol'
import { parseResponse } from './parser'
import { bytesToHex } from '../utils/hex'
import type { ParsedResponse } from '../types'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated'

export class TailgBleConnection {
  private device: BluetoothDevice | null = null
  private server: BluetoothRemoteGATTServer | null = null
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private _state: ConnectionState = 'disconnected'
  private _token: string = ''
  private _keyHex: string
  private _serviceType: 'fee5' | 'fcc0' | 'unknown' = 'unknown'
  private _chars: Map<string, BluetoothRemoteGATTCharacteristic> = new Map()
  private _reconnectAttempts = 0
  private _maxReconnectAttempts = 3
  private _reconnecting = false

  onStateChange: ((state: ConnectionState) => void) | null = null
  onResponse: ((resp: ParsedResponse) => void) | null = null
  onLog: ((msg: string) => void) | null = null
  onDisconnect: (() => void) | null = null

  constructor(keyHex: string) {
    this._keyHex = keyHex
  }

  get state() { return this._state }
  get token() { return this._token }
  get deviceName() { return this.device?.name ?? '' }
  get serviceType() { return this._serviceType }

  set keyHex(k: string) { this._keyHex = k }

  private setState(s: ConnectionState) {
    this._state = s
    this.onStateChange?.(s)
  }

  private log(msg: string) {
    this.onLog?.(msg)
  }

  async scan(): Promise<void> {
    this.setState('connecting')
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [BLE_SERVICE_UUID] },
          { services: [BLE_SERVICE_FCC0] },
          { namePrefix: 'TL_' },
          { namePrefix: 'TAILG_' },
          { namePrefix: 'Hi-TAILING' },
          { namePrefix: 'Q_BASH' },
          { namePrefix: 'QBIKE_' },
          { namePrefix: 'QDemo_' },
        ],
        optionalServices: ALL_SERVICE_UUIDS,
      })
      this.attachDisconnectListener()
      this.log(`选择设备: ${this.device.name ?? this.device.id}`)
    } catch (e) {
      this.setState('disconnected')
      throw e
    }
  }

  async scanAll(): Promise<void> {
    this.setState('connecting')
    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ALL_SERVICE_UUIDS,
      })
      this.attachDisconnectListener()
      this.log(`选择设备: ${this.device.name ?? this.device.id}`)
    } catch (e) {
      this.setState('disconnected')
      throw e
    }
  }

  private attachDisconnectListener() {
    this.device?.addEventListener('gattserverdisconnected', () => {
      this.log('设备断开连接')
      if (this._state !== 'disconnected') {
        this.setState('disconnected')
        this.onDisconnect?.()
        this.attemptReconnect()
      }
    })
  }

  async attemptReconnect(): Promise<void> {
    if (this._reconnecting || !this.device?.gatt) return
    this._reconnecting = true
    this._reconnectAttempts = 0

    while (this._reconnectAttempts < this._maxReconnectAttempts) {
      this._reconnectAttempts++
      const delay = Math.pow(2, this._reconnectAttempts) * 1000
      this.log(`重连中 (${this._reconnectAttempts}/${this._maxReconnectAttempts})，${delay / 1000}s 后重试...`)
      await new Promise(r => setTimeout(r, delay))

      if (this._state !== 'disconnected') {
        this._reconnecting = false
        return
      }

      try {
        await this.connect()
        this.log('重连成功')
        this._reconnecting = false
        this._reconnectAttempts = 0
        return
      } catch (e: unknown) {
        this.log(`重连失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    this._reconnecting = false
    this.log('重连次数已用尽，请手动重新扫描连接')
  }

  get isReconnecting() { return this._reconnecting }

  async connectToSelected(): Promise<void> {
    await this.connect()
  }

  async scanAndConnect(): Promise<void> {
    await this.scan()
    await this.connect()
  }

  async connect(): Promise<void> {
    if (!this.device?.gatt) throw new Error('No device')
    this.setState('connecting')
    this.log('正在连接 GATT...')

    this.server = await this.device.gatt.connect()

    let service: BluetoothRemoteGATTService | null = null

    try {
      service = await this.server.getPrimaryService(BLE_SERVICE_UUID)
      this._serviceType = 'fee5'
      this.log('发现服务: fee5 (标准协议)')
    } catch (e: unknown) {
      console.debug('[BLE] fee5 service not available:', e instanceof Error ? e.message : e)
    }

    if (!service) {
      try {
        service = await this.server.getPrimaryService(BLE_SERVICE_FCC0)
        this._serviceType = 'fcc0'
        this.log('发现服务: fcc0 (QGJ/ECU 协议)')
      } catch (e: unknown) {
        console.debug('[BLE] fcc0 service not available:', e instanceof Error ? e.message : e)
      }
    }

    if (!service) {
      const services = await this.server.getPrimaryServices()
      this.log(`枚举到 ${services.length} 个服务:`)
      for (const s of services) this.log(`  - ${s.uuid}`)
      if (services.length === 0) throw new Error('设备无可用 GATT 服务')
      service = services[0]
      this._serviceType = 'unknown'
    }

    await this.bindCharacteristics(service)

    if (!this.writeChar || !this.notifyChar) {
      throw new Error('未找到可用的读写特征')
    }

    await this.notifyChar.startNotifications()
    this.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify.bind(this))

    this.setState('connected')
    this.log('GATT 连接成功，已订阅通知')

    await this.sendTokenRequest()
  }

  async diagnose(): Promise<void> {
    if (!this.device?.gatt) throw new Error('No device')
    this.setState('connecting')
    this.log('=== 诊断模式: 枚举全部 GATT 结构 ===')

    this.server = await this.device.gatt.connect()
    let services: BluetoothRemoteGATTService[] = []
    try {
      services = await this.server.getPrimaryServices()
    } catch (e: unknown) {
      this.log(`枚举服务失败: ${e instanceof Error ? e.message : String(e)}`)
      this.setState('disconnected')
      return
    }

    this.log(`共发现 ${services.length} 个服务:`)
    for (const svc of services) {
      this.log(`\n[Service] ${svc.uuid}`)
      let chars: BluetoothRemoteGATTCharacteristic[] = []
      try {
        chars = await svc.getCharacteristics()
      } catch {
        this.log('  (无法枚举特征)')
        continue
      }
      for (const c of chars) {
        const p = c.properties
        const flags = [
          p.read && 'Read',
          p.write && 'Write',
          p.writeWithoutResponse && 'WriteNoResp',
          p.notify && 'Notify',
          p.indicate && 'Indicate',
        ].filter(Boolean).join(', ')
        this.log(`  [Char] ${c.uuid}  [${flags}]`)

        if (p.notify || p.indicate) {
          try {
            await c.startNotifications()
            const charUuid = c.uuid
            c.addEventListener('characteristicvaluechanged', (ev) => {
              const val = (ev.target as BluetoothRemoteGATTCharacteristic).value
              if (!val) return
              const raw = new Uint8Array(val.buffer)
              this.log(`← [${charUuid.substring(4, 8)}] ${bytesToHex(raw)}`)
            })
            this.log(`    → 已订阅通知`)
          } catch {
            this.log(`    → 订阅失败`)
          }
        }

        // 保存特征引用供手动发送
        const shortId = c.uuid.substring(4, 8)
        this._chars.set(shortId, c)
      }
    }

    this.setState('connected')
    this.log('\n=== 诊断完成，监听中... ===')
    this.log('可用 writeRaw("fe02", "A700000A100100000000...") 发送数据')

    // 自动尝试 QGJ 登录 (写 feb1，听 feb2)
    if (this._chars.has('feb1')) {
      this.log('\n--- 自动尝试 QGJ 登录 → feb1 ---')
      const loginHex = 'A700000A10010000000000000000'
      await this.writeRaw('feb1', loginHex)

      await this.waitMs(2000)
      if (this._chars.has('fcc1')) {
        this.log('\n--- 登录后尝试 fcc1 指令 ---')
        await this.writeRaw('fcc1', '8503C20D001111111111111100000000')
        await this.waitMs(2000)
        await this.writeRaw('fcc1', 'A700000320010000')
        await this.waitMs(2000)
        await this.writeRaw('fcc1', 'D0018E0AFF00000001AA')
      }
    }
  }

  private waitMs(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  async writeRaw(charShortId: string, hexData: string): Promise<void> {
    const c = this._chars.get(charShortId)
    if (!c) {
      this.log(`错误: 特征 ${charShortId} 不存在，可用: ${[...this._chars.keys()].join(', ')}`)
      return
    }
    const data = new Uint8Array(hexData.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    this.log(`→ [${charShortId}] ${bytesToHex(data)}`)
    try {
      if (c.properties.writeWithoutResponse) {
        await c.writeValueWithoutResponse(data as BufferSource)
      } else {
        await c.writeValue(data as BufferSource)
      }
    } catch (e: unknown) {
      this.log(`写入失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async bindCharacteristics(service: BluetoothRemoteGATTService) {
    if (this._serviceType === 'fee5') {
      this.writeChar = await service.getCharacteristic(BLE_WRITE_UUID)
      this.notifyChar = await service.getCharacteristic(BLE_NOTIFY_UUID)
      return
    }

    if (this._serviceType === 'fcc0') {
      for (const uuid of [BLE_FCC1_UUID, BLE_FBB1_UUID]) {
        try {
          const c = await service.getCharacteristic(uuid)
          this.writeChar = c
          this.notifyChar = c
          this.log(`使用特征: ${uuid.substring(4, 8)}`)
          return
        } catch (e: unknown) {
          console.debug(`[BLE] characteristic ${uuid.substring(4, 8)} not available:`, e instanceof Error ? e.message : e)
        }
      }
    }

    const chars = await service.getCharacteristics()
    this.log(`枚举到 ${chars.length} 个特征:`)
    for (const c of chars) {
      const p = c.properties
      const flags = [p.read && 'R', p.write && 'W', p.writeWithoutResponse && 'w', p.notify && 'N', p.indicate && 'I'].filter(Boolean).join('')
      this.log(`  - ${c.uuid} [${flags}]`)
    }
    this.writeChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) ?? null
    this.notifyChar = chars.find(c => c.properties.notify || c.properties.indicate) ?? null
  }

  private async sendTokenRequest(): Promise<void> {
    const data = buildTokenRequest(this._keyHex)
    this.log(`→ Token 请求: ${bytesToHex(data)}`)
    await this.write(data)
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new Error('Not connected')
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('蓝牙写入超时(5s)，请检查连接')), 5000)
    )
    await Promise.race([this.writeChar.writeValue(data as BufferSource), timeout])
  }

  private handleNotify(event: Event) {
    const char = event.target as BluetoothRemoteGATTCharacteristic
    const value = char.value
    if (!value) return

    const raw = new Uint8Array(value.buffer)
    this.log(`← 原始: ${bytesToHex(raw)}`)
    const resp = parseResponse(this._keyHex, raw)

    if (resp.type === 'token' && resp.token) {
      this._token = resp.token
      this.setState('authenticated')
      this.log(`Token 握手成功: ${resp.token}`)
    }

    this.onResponse?.(resp)
  }

  disconnect(): void {
    this.server?.disconnect()
    this.setState('disconnected')
  }
}
