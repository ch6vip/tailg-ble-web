export interface BikeState {
  isLocked: boolean
  isPowerOn: boolean
  voltage: number | null
  batteryPercent: number | null
  soc: boolean
}

export interface ParsedResponse {
  type: 'token' | 'command' | 'voltage' | 'state' | 'unknown'
  raw: string
  token?: string
  commandType?: string
  statusCode?: string
  success?: boolean
  voltage?: number
  bikeState?: BikeState
}

export type CommandCode =
  | '01' // lock
  | '02' // unlock
  | '05' // open cushion
  | '06' // power on
  | '07' // power off
  | '08' // find (honk)
  | '0D' // read vehicle state
  | '0E' // read anti-theft state

export type ModelType =
  | 'KKS'
  | 'BB'
  | 'AX'
  | 'JD'
  | 'HJ'
  | 'JW'
  | 'XL'
  | 'YY'

export const AES_KEYS: Record<ModelType, string> = {
  KKS: '3A60432A5C01211F291E0F4E0C132825',
  BB: '1AF78CD35BE92F4CA06DB89EC2D7EF01',
  AX: '1AF78CD35BE92F4CA06DB89E7C4B1E6A',
  JD: '1AF78CD35BE92F4CA06DB89E5F3D2A8C',
  HJ: '1AF78CD35BE92F4CA06DB89E9E6C4B1A',
  JW: '1AF78CD35BE92F4CA06DB89E6F8B39A5',
  XL: '1AF78CD35BE92F4CA06DB89E1E6C8A9A',
  YY: '1AF78CD35BE92F4CA06DB89E2A8C3F5D',
}

export const BLE_SERVICE_UUID = '0000fee5-0000-1000-8000-00805f9b34fb'
export const BLE_SERVICE_FCC0 = '0000fcc0-0000-1000-8000-00805f9b34fb'
export const BLE_SERVICE_FE01 = '0000fe01-0000-1000-8000-00805f9b34fb'
export const BLE_WRITE_UUID = '0000feb5-0000-1000-8000-00805f9b34fb'
export const BLE_NOTIFY_UUID = '0000feb6-0000-1000-8000-00805f9b34fb'
export const BLE_HOTDATA_UUID = '0000feb1-0000-1000-8000-00805f9b34fb'
export const BLE_FCC1_UUID = '0000fcc1-0000-1000-8000-00805f9b34fb'
export const BLE_FCC2_UUID = '0000fcc2-0000-1000-8000-00805f9b34fb'
export const BLE_FBB1_UUID = '0000fbb1-0000-1000-8000-00805f9b34fb'
export const BLE_FBB2_UUID = '0000fbb2-0000-1000-8000-00805f9b34fb'

export const ALL_SERVICE_UUIDS = [
  BLE_SERVICE_UUID, BLE_SERVICE_FCC0, BLE_SERVICE_FE01,
]
