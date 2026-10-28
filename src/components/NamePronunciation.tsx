import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { msg } from 'gt-react'
import { profile } from '../data/site'
import { useLocale, useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'
import { alignNamePronunciation } from '../lib/namePronunciation'

export const pronunciationMessage = msg('/ˈiːən hɛnˈriːkɛs/')

export function NamePronunciation() {
  const gt = useTranslate()
  const locale = useLocale()
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)
  const hint = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wasOpen = useRef(false)

  useLayoutEffect(() => {
    const popup = hint.current
    if (!popup) return
    if (open) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timing = getComputedStyle(popup).getPropertyValue('--font-morph-duration').trim()
    const duration = parseFloat(timing) * (timing.endsWith('ms') ? 1 : 1000) || 760
    const start = performance.now()
    let frame = 0
    // rrweb disables CSS transitions. Recording the opacity itself preserves
    // this small fade during playback and when seeking between its frames.
    popup.style.opacity = '1'
    popup.style.visibility = 'visible'
    const fade = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      popup.style.opacity = String(1 - progress * progress * (3 - 2 * progress))
      if (progress < 1) frame = requestAnimationFrame(fade)
      else {
        popup.style.removeProperty('opacity')
        popup.style.removeProperty('visibility')
      }
    }
    frame = requestAnimationFrame(fade)
    return () => {
      cancelAnimationFrame(frame)
      popup.style.removeProperty('opacity')
      popup.style.removeProperty('visibility')
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !hint.current || !root.current) return
    const popup = hint.current
    const anchor = root.current
    const align = () => alignNamePronunciation(anchor, popup)
    align()
    const observer = new ResizeObserver(align)
    observer.observe(anchor)
    observer.observe(popup)
    window.addEventListener('resize', align)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', align)
    }
  }, [open, locale])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false)
        setPinned(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <span
      ref={root}
      className="name-pronunciation"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpen(true)
      }}
      onPointerLeave={() => {
        if (!pinned && !root.current?.querySelector(':focus-visible')) setOpen(false)
      }}
      onBlur={() => {
        if (!pinned) setOpen(false)
      }}
    >
      <button
        type="button"
        className="name-pronunciation-trigger"
        aria-describedby={id}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        onClick={() => {
          setPinned(true)
          setOpen(true)
        }}
      >
        Ian
      </button>
      <span
        ref={hint}
        id={id}
        role="tooltip"
        className="name-pronunciation-hint"
        data-open={open || undefined}
        aria-hidden={!open}
        lang={locale === 'ja' ? 'ja' : 'en'}
        data-_gt-hash={translationHash(profile.pronunciation)}
      >
        {gt(profile.pronunciation)}
      </span>
    </span>
  )
}
