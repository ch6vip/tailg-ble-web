const ALLOWED_ORIGIN = 'https://tl.tttq.de'

const ALLOWED_PATHS = [
  '/v1/api/app/getCode',
  '/v1/api/app/login',
  '/v1/api/app/centralControl/carStatus',
  '/v1/api/app/device/cmd/lock',
  '/v1/api/app/device/cmd/unlock',
  '/v1/api/app/device/cmd/start',
  '/v1/api/app/device/cmd/stop',
  '/v1/api/app/device/cmd/search',
  '/v1/api/app/device/cmd/openCushion',
]

function isAllowedUrl(url: string): boolean {
  if (!url.startsWith('https://www.tailgdd.com')) return false
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'www.tailgdd.com') return false
    if (parsed.protocol !== 'https:') return false
    return ALLOWED_PATHS.some(p => parsed.pathname === p || parsed.pathname.startsWith(p + '?'))
  } catch {
    return false
  }
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (origin === ALLOWED_ORIGIN) return true
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return true
  return false
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('Origin')

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (!isAllowedOrigin(origin)) {
      return json({ error: 'forbidden' }, 403, origin)
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, origin)
    }

    const { url, method, headers, body } = await request.json<ProxyRequest>()

    if (!isAllowedUrl(url)) {
      return json({ error: 'invalid url' }, 400, origin)
    }

    const resp = await fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body: method !== 'GET' ? body : undefined,
      redirect: 'manual',
    })

    if (resp.status >= 300 && resp.status < 400) {
      return json({ error: 'redirect not allowed', status: resp.status }, 403, origin)
    }

    const respHeaders: Record<string, string> = {}
    resp.headers.forEach((v, k) => { respHeaders[k] = v })

    const respBody = await resp.text()

    return new Response(
      JSON.stringify({ status: resp.status, headers: respHeaders, body: respBody }),
      { status: 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } }
    )
  },
}

interface ProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin! : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}
