import { $, errMsg } from '../dom'

function unlock() {
  $('lock-screen').classList.add('is-hidden')
  document.querySelector('.app')!.classList.remove('is-hidden')
}

async function tryUnlock() {
  const pwd = ($('lock-pwd') as HTMLInputElement).value
  if (!pwd) return
  try {
    const resp = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pwd }),
    })
    const data = await resp.json()
    if (data.ok) {
      sessionStorage.setItem('unlocked', '1')
      unlock()
    } else {
      $('lock-error').classList.add('is-visible')
    }
  } catch (e: unknown) {
    console.debug('[Auth] unlock request failed:', errMsg(e))
    $('lock-error').classList.add('is-visible')
  }
}

export function initLock() {
  const saved = sessionStorage.getItem('unlocked')
  if (saved === '1') { unlock(); return }

  $('lock-btn').addEventListener('click', tryUnlock)
  $('lock-pwd').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') tryUnlock()
  })
}
