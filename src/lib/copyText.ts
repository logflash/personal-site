/** Copy within the button's user gesture, including HTTP LAN previews. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some browsers deny the async API but permit a user-triggered copy.
    }
  }

  // HTTP LAN origins do not expose navigator.clipboard. Keep this synchronous
  // when that API is absent so mobile browsers retain the tap's activation.
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : []
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.tabIndex = -1
  field.className = 'rr-block'
  field.setAttribute('aria-hidden', 'true')
  Object.assign(field.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  })
  document.body.append(field)
  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, text.length)
    // Deprecated, but still needed on browsers serving the HTTP LAN preview.
    if (!document.execCommand('copy')) throw new Error('Clipboard copy was denied')
  } finally {
    field.remove()
    if (active?.isConnected) active.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }
}
