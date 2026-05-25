import type { TailgBleConnection } from '../ble/connection'
import {
  CMD_NAMES, DANGEROUS_COMMANDS,
  executeCommand, setCommandBusy,
} from '../commands'
import { getState } from '../state'
import { errMsg, log } from '../dom'
import { setFeedback, getFeedbackState, resetFeedbackState } from './feedback'
import type { CommandCode } from '../types'

function armDangerousCommand(
  btn: HTMLButtonElement,
  cmd: CommandCode,
  run: () => Promise<void>,
  onReset: () => void,
) {
  let timer: number | undefined
  let armed = false
  let pointerId: number | undefined
  const originalText = btn.querySelector('.text')?.textContent ?? ''

  const reset = () => {
    if (timer != null) window.clearTimeout(timer)
    timer = undefined
    armed = false
    if (pointerId != null && btn.hasPointerCapture?.(pointerId)) {
      btn.releasePointerCapture(pointerId)
    }
    pointerId = undefined
    btn.classList.remove('is-holding')
    const text = btn.querySelector('.text')
    if (text) text.textContent = originalText
    if (getFeedbackState() === 'Hold') {
      resetFeedbackState()
      onReset()
    }
  }

  const start = (event: PointerEvent) => {
    if (btn.disabled || getState().controlBusy) return
    event.preventDefault()
    pointerId = event.pointerId
    btn.setPointerCapture?.(event.pointerId)
    armed = true
    btn.classList.add('is-holding')
    const text = btn.querySelector('.text')
    if (text) text.textContent = '继续按住'
    setFeedback(`长按确认${CMD_NAMES[cmd]}`, '保持按住 1 秒执行危险动作，松开取消。', 'Hold')
    timer = window.setTimeout(async () => {
      if (!armed) return
      reset()
      await run()
    }, 1000)
  }

  btn.addEventListener('pointerdown', start)
  btn.addEventListener('pointerup', reset)
  btn.addEventListener('pointerleave', reset)
  btn.addEventListener('pointercancel', reset)
  btn.addEventListener('lostpointercapture', reset)
  btn.addEventListener('contextmenu', (event) => event.preventDefault())
  window.addEventListener('blur', reset)
}

export function bindCommandButtons(conn: TailgBleConnection, onReset: () => void) {
  document.querySelectorAll<HTMLButtonElement>('.cmd-btn').forEach((btn) => {
    const run = async () => {
      try {
        const cmd = btn.dataset.cmd as CommandCode
        if (!cmd) return
        await executeCommand(conn, cmd)
      } catch (e: unknown) {
        setCommandBusy(false, btn.dataset.cmd ?? '')
        const msg = errMsg(e)
        log(`指令执行异常: ${msg}`)
        setFeedback('指令执行异常', msg || '请检查连接后重试。', 'Fail')
      }
    }
    const cmd = btn.dataset.cmd as CommandCode
    if (DANGEROUS_COMMANDS.has(cmd)) {
      armDangerousCommand(btn, cmd, run, onReset)
    } else {
      btn.addEventListener('click', run)
    }
  })
}
