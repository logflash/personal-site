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
  const stageRef = useRef<HTMLSpanElement>(null)
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
    const stage = stageRef.current
    if (!source || !target || !stage) return
    let disposed = false
    const refresh = () => {
      // Use local CSS dimensions, including fractional pixels. Viewport bounds
      // would apply the recording layout's scale a second time.
      for (const [role, endpoint] of [
        ['sans', source],
        ['serif', target],
      ] as const) {
        const style = getComputedStyle(endpoint)
        stage.style.setProperty(`--not-found-${role}-width`, style.width)
        stage.style.setProperty(`--not-found-${role}-height`, style.height)
      }
      controllerRef.current?.refresh()
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    const resizeObserver = new ResizeObserver(refresh)
    resizeObserver.observe(source)
    resizeObserver.observe(target)
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
        // Keep the artwork in the same scroll/compositing layer as the page.
        // Elastic overscroll can move it without emitting a JS scroll event.
        const overlay = controller.element.parentElement
        stage.append(controller.element)
        overlay?.remove()
        refresh()
        stage.style.setProperty('--not-found-progress', String(progressRef.current))
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
      resizeObserver.disconnect()
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
      stageRef.current?.style.setProperty('--not-found-progress', String(target))
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
      stageRef.current?.style.setProperty('--not-found-progress', String(progressRef.current))
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
      <span ref={stageRef} className="not-found-specimen-stage" aria-hidden="true">
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
