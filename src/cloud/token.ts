export function persistToken(token: string): void {
  if (token) {
    localStorage.setItem('cloudToken', token)
  } else {
    localStorage.removeItem('cloudToken')
  }
  fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token }),
  }).catch(() => {})
}
