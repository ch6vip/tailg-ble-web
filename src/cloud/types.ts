export interface CarInfo {
  imei: string
  imeiGps: string
  carId: string
  carName: string
  carNickName: string
  carPhoto: string
  frame: string
  defenceStatus: number
  acc: number
  electricQuantity: number
  voltage: number
  online: boolean
  btname: string
  btmac: string
  longitude: string
  latitude: string
  modelType: number
  mileage?: number
}

const GPS_MODEL_TYPES = new Set([3, 8, 1501, 1601, 1701])

export function getCommandImei(car: CarInfo): string {
  if (GPS_MODEL_TYPES.has(car.modelType) && car.imeiGps) {
    return car.imeiGps
  }
  return car.imei
}

export type CloudCmd = 'lock' | 'unlock' | 'start' | 'stop' | 'search' | 'openCushion'

export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  body: string
}
