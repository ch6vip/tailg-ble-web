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

  onStateChange: ((state: ConnectionState) => void) | null = null
  onResponse: ((resp: ParsedResponse) => void) | null = null
  onLog: ((msg: string) => void) | null = null

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
      this.setState('disconnected')
      this.log('设备断开连接')
    })
  }

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
    } catch {}

    if (!service) {
      try {
        service = await this.server.getPrimaryService(BLE_SERVICE_FCC0)
        this._serviceType = 'fcc0'
        this.log('发现服务: fcc0 (QGJ/ECU 协议)')
      } catch {}
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
        } catch {}
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
    await this.writeChar.writeValue(data as unknown as BufferSource)
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
