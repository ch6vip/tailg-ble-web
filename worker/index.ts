interface Env {
  APP_PASSWORD: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405)
    }

    const url = new URL(request.url)

    if (url.pathname === '/auth') {
      const { password } = await request.json<{ password: string }>()
      if (password === env.APP_PASSWORD) {
        return json({ ok: true })
      }
      return json({ ok: false }, 401)
    }

    if (url.pathname === '/proxy') {
      const { url: targetUrl, method, headers, body } = await request.json<ProxyRequest>()

      if (!targetUrl || !targetUrl.startsWith('https://www.tailgdd.com/')) {
        return json({ error: 'invalid url' }, 400)
      }

      const resp = await fetch(targetUrl, {
        method: method || 'GET',
        headers: headers || {},
        body: method !== 'GET' ? body : undefined,
      })

      const respHeaders: Record<string, string> = {}
      resp.headers.forEach((v, k) => { respHeaders[k] = v })

      const respBody = await resp.text()

      return new Response(
        JSON.stringify({ status: resp.status, headers: respHeaders, body: respBody }),
        { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
      )
    }

    return json({ error: 'not found' }, 404)
  },
}

interface ProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}
