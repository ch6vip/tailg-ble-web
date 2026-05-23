export interface CarInfo {
  imei: string
  carId: string
  carName: string
  frame: string
  defenceStatus: '0' | '1'
  acc: '0' | '1'
  electricQuantity: string
  voltage: string
  online: string
  btname: string
  btmac: string
  longitude: string
  latitude: string
  modelType: number
}

export type CloudCmd = 'lock' | 'unlock' | 'start' | 'stop' | 'search' | 'openCushion'

export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  body: string
}
