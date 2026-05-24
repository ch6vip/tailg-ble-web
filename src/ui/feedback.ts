export type FeedbackMark = 'Idle' | 'Ready' | 'Hold' | 'TX' | 'OK' | 'Fail' | 'Timeout'

let currentState: FeedbackMark = 'Idle'

export function getFeedbackState(): FeedbackMark {
  return currentState
}

export function setFeedback(title: string, text: string, mark: FeedbackMark = 'Idle') {
  currentState = mark
  const box = document.querySelector<HTMLElement>('.feedback')
  const titleEl = document.getElementById('command-feedback-title')
  const textEl = document.getElementById('command-feedback-text')
  const markEl = document.getElementById('command-feedback-mark')
  if (box) box.dataset.state = mark
  if (titleEl) titleEl.textContent = title
  if (textEl) textEl.textContent = text
  if (markEl) markEl.textContent = mark
}

export function shouldRenderReadyFeedback() {
  return currentState === 'Idle' || currentState === 'Ready'
}

export function resetFeedbackState() {
  currentState = 'Idle'
}
