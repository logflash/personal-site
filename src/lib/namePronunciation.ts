/** Align in local CSS units, including the scaled gt-rrweb capture frame. */
export function alignNamePronunciation(anchor: HTMLElement, popup: HTMLElement) {
  const word = anchor.getBoundingClientRect()
  const box = popup.getBoundingClientRect()
  const bounds = anchor.closest('.intro')?.getBoundingClientRect()
  const viewport = anchor.ownerDocument.documentElement.clientWidth
  const left = Math.max(8, bounds?.left ?? 8)
  const right = Math.min(viewport - 8, bounds?.right ?? viewport - 8)
  const centeredLeft = word.left + (word.width - box.width) / 2
  const shift = Math.max(left - centeredLeft, Math.min(0, right - centeredLeft - box.width))
  const scale = box.width / popup.offsetWidth || 1
  const value = `${(shift / scale).toFixed(3)}px`
  if (popup.style.getPropertyValue('--pronunciation-shift') !== value)
    popup.style.setProperty('--pronunciation-shift', value)
}

/** Replay runs without React, so remeasure when translated text changes width. */
export function alignReplayPronunciation(document: Document, locale: string | undefined) {
  for (const popup of document.querySelectorAll<HTMLElement>('.name-pronunciation-hint')) {
    const anchor = popup.parentElement
    if (anchor) alignNamePronunciation(anchor, popup)
    const lang = locale === 'ja' ? 'ja' : 'en'
    if (popup.lang !== lang) popup.lang = lang
  }
}
