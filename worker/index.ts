export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405)
    }

    const { url, method, headers, body } = await request.json<ProxyRequest>()

    if (!url || !url.startsWith('https://www.tailgdd.com/')) {
      return json({ error: 'invalid url' }, 400)
    }

    const resp = await fetch(url, {
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
