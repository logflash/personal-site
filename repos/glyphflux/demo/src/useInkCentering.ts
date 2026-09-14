import type { RefObject } from 'react'
import { useLayoutEffect } from 'react'
import { applyComputedCanvasTextStyle } from './canvasText'

function centerVisibleInk(
  text: HTMLElement,
  container: HTMLElement,
  shifted: HTMLElement,
) {
  const style = getComputedStyle(text)
  const context = text.ownerDocument.createElement('canvas').getContext('2d')
  if (!context) return
  applyComputedCanvasTextStyle(context, style)
  const metrics = context.measureText(text.textContent ?? '')

  const marker = text.ownerDocument.createElement('i')
  marker.setAttribute('aria-hidden', 'true')
  marker.style.cssText =
    'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline;'
  text.append(marker)
  const baseline = marker.getBoundingClientRect().top
  marker.remove()

  const currentCenter =
    baseline + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2
  const bounds = container.getBoundingClientRect()
  const desiredCenter = bounds.top + bounds.height / 2
  const currentOffset = Number(shifted.dataset.demoInkOffset ?? 0)
  const nextOffset = currentOffset + desiredCenter - currentCenter
  if (!Number.isFinite(nextOffset)) return
  shifted.dataset.demoInkOffset = String(nextOffset)
  shifted.style.setProperty('--demo-ink-offset', `${nextOffset}px`)
}

export function useInkCentering(
  textRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  shiftedRef: RefObject<HTMLElement | null>,
  identity: string,
) {
  useLayoutEffect(() => {
    const text = textRef.current
    const container = containerRef.current
    const shifted = shiftedRef.current
    if (!text || !container || !shifted) return
    let current = true
    const update = () => {
      if (current) centerVisibleInk(text, container, shifted)
    }
    update()
    void text.ownerDocument.fonts.ready.then(update)
    const observer = new ResizeObserver(update)
    observer.observe(container)
    text.ownerDocument.defaultView?.addEventListener('resize', update)
    return () => {
      current = false
      observer.disconnect()
      text.ownerDocument.defaultView?.removeEventListener('resize', update)
    }
  }, [containerRef, identity, shiftedRef, textRef])
}
