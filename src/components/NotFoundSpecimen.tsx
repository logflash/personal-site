import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createFontMorphProgressController, type FontMorphProgressController } from 'glyphflux'
import '../lib/fontMorph'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'

/** Keep the decorative numerals in one renderer, including their resting frames. */
export function NotFoundSpecimen() {
  const gt = useTranslate()
  const [serif, setSerif] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const sansRef = useRef<HTMLSpanElement>(null)
  const serifRef = useRef<HTMLSpanElement>(null)
  const controllerRef = useRef<FontMorphProgressController | null>(null)
  const progressRef = useRef(1)
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
    if (busy) return
    const target = serif ? 0 : 1
    const controller = controllerRef.current
    setSerif(!serif)
    if (!controller || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progressRef.current = target
      controller?.setProgress(target)
      return
    }
    setBusy(true)
    const source = progressRef.current
    const startedAt = performance.now()
    const animate = (now: number) => {
      const time = Math.min(1, (now - startedAt) / 760)
      const eased = time * time * (3 - 2 * time)
      progressRef.current = source + (target - source) * eased
      controller.setProgress(progressRef.current)
      if (time < 1) frameRef.current = requestAnimationFrame(animate)
      else setBusy(false)
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
      disabled={busy}
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
      <span className="not-found-specimen-caption">
        <span data-_gt-hash={translationHash('Change typeface')}>{gt('Change typeface')}</span>
        <span aria-hidden="true">↔</span>
      </span>
    </button>
  )
}
