const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 80
const STATIC_DIR = '/var/www'
const DATA_FILE = '/data/store.json'
const PASSWORD = process.env.APP_PASSWORD || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://tl.tttq.de').split(',')
const MAX_BODY = 1024

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

const loginAttempts = new Map()
const AUTH_MAX_ATTEMPTS = 5
const AUTH_LOCKOUT_MS = 5 * 60 * 1000

const sessions = new Set()

function isRateLimited(ip) {
  const record = loginAttempts.get(ip)
  if (!record) return false
  if (Date.now() - record.firstAttempt > AUTH_LOCKOUT_MS) {
    loginAttempts.delete(ip)
    return false
  }
  return record.count >= AUTH_MAX_ATTEMPTS
}

function recordFailedAttempt(ip) {
  const record = loginAttempts.get(ip)
  if (!record) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() })
  } else {
    record.count++
  }
}

function clearAttempts(ip) {
  loginAttempts.delete(ip)
}

function generateSessionId() {
  return Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join('')
}

function getSessionFromReq(req) {
  const cookie = req.headers.cookie || ''
  const match = cookie.match(/session=([^;]+)/)
  return match ? match[1] : null
}

function isAuthenticated(req) {
  const sid = getSessionFromReq(req)
  return sid && sessions.has(sid)
}

function getCorsOrigin(req) {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.includes(origin)) return origin
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return origin
  return ALLOWED_ORIGINS[0]
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch { return {} }
}

function saveStore(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > MAX_BODY) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      body += c
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || ''
}

const server = http.createServer(async (req, res) => {
  const origin = getCorsOrigin(req)
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'POST' && req.url === '/auth') {
    const ip = getClientIp(req)
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, msg: '尝试次数过多，请稍后再试' }))
      return
    }
    let body
    try { body = await readBody(req) } catch {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, msg: 'Body too large' }))
      return
    }
    const { password } = JSON.parse(body)
    const ok = password === PASSWORD
    if (ok) {
      clearAttempts(ip)
      const sid = generateSessionId()
      sessions.add(sid)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
      })
      res.end(JSON.stringify({ ok: true }))
    } else {
      recordFailedAttempt(ip)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false }))
    }
    return
  }

  if (req.url === '/api/token') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '未授权' }))
      return
    }
    if (req.method === 'GET') {
      const store = loadStore()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: store.cloudToken || '' }))
      return
    }
    if (req.method === 'POST') {
      let body
      try { body = await readBody(req) } catch {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, msg: 'Body too large' }))
        return
      }
      const { token } = JSON.parse(body)
      const store = loadStore()
      store.cloudToken = token || ''
      saveStore(store)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
  }

  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url)
  if (!fs.existsSync(filePath)) filePath = path.join(STATIC_DIR, 'index.html')

  const ext = path.extname(filePath)
  const mime = MIME[ext] || 'application/octet-stream'

  try {
    const content = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': mime })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not Found')
  }
})

server.listen(PORT, () => console.log(`Server running on :${PORT}`))
