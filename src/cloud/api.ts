import type { CarInfo, CloudCmd, ProxyResponse } from './types'

const PROXY_BASE = 'https://tailg-proxy.ch6vip.workers.dev'
const API_V1 = 'https://www.tailgdd.com/v1/api/'

async function proxyFetch(url: string, method: string, headers: Record<string, string>, body?: string): Promise<ProxyResponse> {
  const resp = await fetch(`${PROXY_BASE}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method, headers, body }),
  })
  if (!resp.ok) throw new Error(`Proxy error: ${resp.status}`)
  return resp.json()
}

export async function getSmsCode(phone: string): Promise<void> {
  const res = await proxyFetch(`${API_V1}app/getCode?phone=${phone}`, 'GET', {})
  const data = JSON.parse(res.body)
  if (data.code !== '200' && data.code !== 200) {
    throw new Error(data.msg || '获取验证码失败')
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
    JSON.stringify({ phoneMode: 'web' })
  )
  const data = JSON.parse(res.body)
  if (data.code !== '200' && data.code !== 200) {
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
  if (data.code !== '200' && data.code !== 200) {
    throw new Error(data.msg || `指令 ${cmd} 失败`)
  }
  return data.msg || 'success'
}
