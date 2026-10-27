import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createFontMorphProgressController, type FontMorphProgressController } from 'glyphflux'
import '../lib/fontMorph'
import { useTranslate } from '../lib/i18n'

/** Keep the decorative numerals in one renderer, including their resting frames. */
export function NotFoundSpecimen() {
  const gt = useTranslate()
  const [serif, setSerif] = useState(true)
  const [ready, setReady] = useState(false)
  const sansRef = useRef<HTMLSpanElement>(null)
  const serifRef = useRef<HTMLSpanElement>(null)
  const controllerRef = useRef<FontMorphProgressController | null>(null)
  const progressRef = useRef(1)
  const phaseRef = useRef(1)
  const targetRef = useRef(1)
  const frameRef = useRef(0)

  useEffect(() => {
    const source = sansRef.current
    const target = serifRef.current
    if (!source || !target) return
    let disposed = false
    const refresh = () => controllerRef.current?.refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    window.addEventListener('scroll', refresh, true)
    void createFontMorphProgressController({ source, target, initialProgress: progressRef.current })
      .then((controller) => {
        if (disposed) {
          controller.destroy()
          return
        }
        controllerRef.current = controller
        // This is persistent decorative artwork, so rrweb records its SVG
        // mutations directly, including the exact resting frame.
        controller.element.classList.remove('rr-block')
        controller.element.classList.add('not-found-artwork')
        controller.element.parentElement?.classList.remove('rr-block')
        // A resting illustration belongs below sticky navigation and dialogs.
        controller.element.style.zIndex = '0'
        if (controller.element.parentElement) controller.element.parentElement.style.zIndex = '0'
        controller.setProgress(progressRef.current)
        flushSync(() => setReady(true))
      })
      .catch(() => {
        // Keep the native-text switch when optional outline preparation fails.
      })
    return () => {
      disposed = true
      cancelAnimationFrame(frameRef.current)
      observer.disconnect()
      window.removeEventListener('scroll', refresh, true)
      controllerRef.current?.destroy()
      controllerRef.current = null
    }
  }, [])

  const change = () => {
    cancelAnimationFrame(frameRef.current)
    const target = targetRef.current === 1 ? 0 : 1
    targetRef.current = target
    const controller = controllerRef.current
    setSerif(target === 1)
    if (!controller || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      phaseRef.current = target
      progressRef.current = target
      controller?.setProgress(target)
      return
    }
    // Reverse the same eased timeline from its last painted frame. Restarting
    // the easing curve would introduce a pause on every click or tap.
    const source = phaseRef.current
    const direction = target === 1 ? 1 : -1
    const startedAt = performance.now()
    const animate = (now: number) => {
      const phase = Math.max(0, Math.min(1, source + (direction * (now - startedAt)) / 760))
      phaseRef.current = phase
      progressRef.current = phase * phase * (3 - 2 * phase)
      controller.setProgress(progressRef.current)
      if (phase !== target) frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
  }

  return (
    <button
      type="button"
      className="not-found-specimen"
      data-ready={ready || undefined}
      data-typeface={serif ? 'serif' : 'sans'}
      onClick={change}
      aria-label={gt('Change typeface')}
    >
      <span className="not-found-specimen-stage" aria-hidden="true">
        <span ref={sansRef} className="not-found-sans">
          404
        </span>
        <span ref={serifRef} className="not-found-serif">
          404
        </span>
      </span>
    </button>
  )
}
