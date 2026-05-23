const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 80
const STATIC_DIR = '/var/www'
const DATA_FILE = '/data/store.json'
const PASSWORD = process.env.APP_PASSWORD || ''

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch { return {} }
}

function saveStore(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(data))
}

function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => resolve(body))
  })
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'POST' && req.url === '/auth') {
    const { password } = JSON.parse(await readBody(req))
    const ok = password === PASSWORD
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok }))
    return
  }

  if (req.method === 'GET' && req.url === '/api/token') {
    const store = loadStore()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ token: store.cloudToken || '' }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/token') {
    const { token } = JSON.parse(await readBody(req))
    const store = loadStore()
    store.cloudToken = token || ''
    saveStore(store)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
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
