const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 80
const STATIC_DIR = '/var/www'
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/auth') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body)
        const ok = password === PASSWORD
        res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false }))
      }
    })
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
