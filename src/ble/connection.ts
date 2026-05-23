import { BLE_SERVICE_UUID, BLE_WRITE_UUID, BLE_NOTIFY_UUID } from '../types'
import { buildTokenRequest } from './protocol'
import { parseResponse } from './parser'
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

  onStateChange: ((state: ConnectionState) => void) | null = null
  onResponse: ((resp: ParsedResponse) => void) | null = null
  onLog: ((msg: string) => void) | null = null

  constructor(keyHex: string) {
    this._keyHex = keyHex
  }

  get state() { return this._state }
  get token() { return this._token }
  get deviceName() { return this.device?.name ?? '' }

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
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_SERVICE_UUID],
      })
      this.device.addEventListener('gattserverdisconnected', () => {
        this.setState('disconnected')
        this.log('设备断开连接')
      })
      this.log(`选择设备: ${this.device.name ?? this.device.id}`)
    } catch (e) {
      this.setState('disconnected')
      throw e
    }
  }

  async connect(): Promise<void> {
    if (!this.device?.gatt) throw new Error('No device')
    this.setState('connecting')
    this.log('正在连接 GATT...')

    this.server = await this.device.gatt.connect()
    const service = await this.server.getPrimaryService(BLE_SERVICE_UUID)

    this.writeChar = await service.getCharacteristic(BLE_WRITE_UUID)
    this.notifyChar = await service.getCharacteristic(BLE_NOTIFY_UUID)

    await this.notifyChar.startNotifications()
    this.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify.bind(this))

    this.setState('connected')
    this.log('GATT 连接成功，已订阅通知')

    await this.sendTokenRequest()
  }

  async scanAndConnect(): Promise<void> {
    await this.scan()
    await this.connect()
  }

  private async sendTokenRequest(): Promise<void> {
    const data = buildTokenRequest(this._keyHex)
    this.log(`发送 Token 请求: ${data.length} bytes`)
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
