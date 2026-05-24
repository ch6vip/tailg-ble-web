export function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing DOM element #${id}`)
  return el
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const MAX_LOG_LINES = 400

export function log(msg: string) {
  const el = $('log') as HTMLTextAreaElement
  const ts = new Date().toLocaleTimeString()
  const lines = el.value ? el.value.split('\n').filter(Boolean) : []
  lines.push(`[${ts}] ${msg}`)
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES)
  el.value = `${lines.join('\n')}\n`
  el.scrollTop = el.scrollHeight
}
