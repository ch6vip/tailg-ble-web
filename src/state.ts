import type { CarInfo } from './cloud/types'
import type { ConnectionState } from './ble/connection'

export interface AppState {
  cloudToken: string
  selectedCar: CarInfo | null
  activeChannel: 'cloud' | 'ble'
  controlBusy: boolean
  debugBusy: boolean
  defenceState: string
  powerState: string
  bleState: ConnectionState
  bleToken: string
  bleDeviceName: string
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void

const state: AppState = {
  cloudToken: '',
  selectedCar: null,
  activeChannel: 'cloud',
  controlBusy: false,
  debugBusy: false,
  defenceState: '--',
  powerState: '--',
  bleState: 'disconnected',
  bleToken: '',
  bleDeviceName: '',
}

const listeners: Listener[] = []

export function getState(): Readonly<AppState> {
  return state
}

export function setState(partial: Partial<AppState>): void {
  const changed = new Set<keyof AppState>()
  for (const [k, v] of Object.entries(partial)) {
    const key = k as keyof AppState
    if ((state as unknown as Record<string, unknown>)[key] !== v) {
      ;(state as unknown as Record<string, unknown>)[key] = v
      changed.add(key)
    }
  }
  if (changed.size > 0) {
    for (const fn of listeners) fn(state, changed)
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}
