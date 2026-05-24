import type { CarInfo, CloudCmd, ProxyResponse } from './types'
import { persistToken } from './token'

const PROXY_BASE = 'https://tailg-proxy.ch6vip.workers.dev'
const API_V1 = 'https://www.tailgdd.com/v1/api/'

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Forward-ServiceIp': 'localhost',
  'language': 'zh_CN',
  'Api-Version': '3.0.0',
  'User-Agent': 'okhttp/4.9.3',
}

async function proxyFetch(url: string, method: string, headers: Record<string, string>, body?: string): Promise<ProxyResponse> {
  const resp = await fetch(`${PROXY_BASE}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method, headers: { ...BASE_HEADERS, ...headers }, body }),
  })
  if (!resp.ok) throw new Error(`Proxy error: ${resp.status}`)
  const res: ProxyResponse = await resp.json()
  const newToken = res.headers['authorization'] || res.headers['Authorization']
  if (newToken) {
    persistToken(newToken)
  }
  return res
}

interface ApiResponse {
  code?: number | string
  msg?: string
  data?: unknown
}

function isSuccess(data: ApiResponse): boolean {
  const code = String(data.code)
  return code === '200' || code === '0' || (data.msg?.includes('成功') ?? false)
}

export async function getSmsCode(phone: string): Promise<void> {
  const res = await proxyFetch(
    `${API_V1}app/getCode?phone=${phone}`,
    'POST',
    {},
  )
  const data = JSON.parse(res.body)
  if (!isSuccess(data)) {
    throw new Error(data.msg || `服务器返回: ${res.body}`)
  }
}

export async function login(phone: string, smsCode: string): Promise<string> {
  const res = await proxyFetch(
    `${API_V1}app/login`,
    'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ macCode: '000000000000', phone, smsCode, autoCompleteUserDetail: 'true' })
  )

  const token = res.headers['authorization'] || res.headers['Authorization']
  if (!token) {
    const data = JSON.parse(res.body)
    throw new Error(data.msg || '登录失败，未返回 token')
  }
  return token
}

export async function getCarStatus(token: string): Promise<CarInfo[]> {
  const res = await proxyFetch(
    `${API_V1}app/centralControl/carStatus`,
    'POST',
    { 'Content-Type': 'application/json', Authorization: token },
    JSON.stringify({ phoneMode: 'SM-G998B' })
  )
  const data = JSON.parse(res.body)
  console.debug('[Cloud] carStatus raw response:', JSON.stringify(data, null, 2))
  if (!isSuccess(data)) {
    throw new Error(data.msg || '获取车辆信息失败')
  }
  const result = data.data
  return Array.isArray(result) ? result : [result]
}

export async function sendCommand(token: string, imei: string, cmd: CloudCmd): Promise<string> {
  const res = await proxyFetch(
    `${API_V1}app/device/cmd/${cmd}`,
    'POST',
    { 'Content-Type': 'application/json', Authorization: token },
    JSON.stringify({ imei })
  )
  const data = JSON.parse(res.body)
  if (!isSuccess(data)) {
    throw new Error(data.msg || `指令 ${cmd} 失败`)
  }
  return data.msg || 'success'
}

export async function checkToken(token: string): Promise<boolean> {
  try {
    const res = await proxyFetch(
      `${API_V1}app/centralControl/carStatus`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: token },
      JSON.stringify({ phoneMode: 'SM-G998B' })
    )
    return res.status === 200 && !res.body.includes('"401"')
  } catch (e: unknown) {
    console.debug('[Cloud] token check failed:', e instanceof Error ? e.message : e)
    return false
  }
}

export interface SavedAccount {
  phone: string
  token: string
  savedAt: number
}

export function getSavedAccounts(): SavedAccount[] {
  try {
    return JSON.parse(localStorage.getItem('accounts') || '[]')
  } catch (e: unknown) {
    console.debug('[Cloud] failed to parse saved accounts:', e instanceof Error ? e.message : e)
    return []
  }
}

export function saveAccount(phone: string, token: string) {
  const accounts = getSavedAccounts().filter(a => a.phone !== phone)
  accounts.unshift({ phone, token, savedAt: Date.now() })
  localStorage.setItem('accounts', JSON.stringify(accounts))
  persistToken(token)
}

export function removeAccount(phone: string) {
  const accounts = getSavedAccounts().filter(a => a.phone !== phone)
  localStorage.setItem('accounts', JSON.stringify(accounts))
}
