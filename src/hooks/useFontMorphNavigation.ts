import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent } from 'react'
import { beginFontMorph, prepareFontMorph } from '../lib/fontMorph'
import {
  destinationMorphKey,
  morphSourceKey,
  rememberMorphCause,
  type FontMorphCause,
} from '../lib/fontMorphCause'

type KeyResolver = () => string | undefined

function activeDestinationKey() {
  return document.querySelector<HTMLElement>('[data-transition-heading] [data-font-morph]')?.dataset
    .fontMorph
}

function useResolvedFontMorphNavigation(resolveKey: KeyResolver, remember?: () => void) {
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.currentTarget.target === '_blank'
      ) {
        return
      }
      const key = resolveKey()
      if (key) {
        remember?.()
        beginFontMorph(key)
      }
    },
    [resolveKey, remember],
  )
  const prepare = useCallback(() => {
    const key = resolveKey()
    if (key) void prepareFontMorph(key).catch(() => undefined)
  }, [resolveKey])

  useEffect(() => {
    // Decode the build-generated, locale-sized correspondence manifest as soon
    // as the initial page is interactive. Unknown text is prepared in a worker;
    // neither path can add OpenType parsing to the main-thread click path.
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(prepare, { timeout: 1_500 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timeoutId = globalThis.setTimeout(prepare, 250)
    return () => globalThis.clearTimeout(timeoutId)
  }, [prepare])

  return useMemo(
    () => ({ onClick, onPointerDown: prepare, onPointerEnter: prepare }),
    [onClick, prepare],
  )
}

export function useFontMorphNavigation(key: string, cause?: FontMorphCause) {
  const resolveKey = useCallback(() => (cause ? morphSourceKey(key, cause) : key), [key, cause])
  const remember = useCallback(() => {
    if (cause) rememberMorphCause(key, cause)
  }, [key, cause])
  return useResolvedFontMorphNavigation(resolveKey, remember)
}

export function useDestinationMorphKey(key: string) {
  const [resolved, setResolved] = useState(() => morphSourceKey(key, 'sidebar'))
  useLayoutEffect(() => {
    const root = document.documentElement
    const active = root.dataset.fontMorphActive
    setResolved(
      active === key || active === `${key}::sidebar` || active === `${key}::topbar`
        ? active
        : destinationMorphKey(key),
    )
    const update = () => {
      if (!root.hasAttribute('data-font-morph-active')) setResolved(destinationMorphKey(key))
    }
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-font-morph-active'] })
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [key])
  return resolved
}

/** Resolve the transition from content-authored destination markup at the
 * moment of interaction, keeping route chrome independent of page names. */
export function useActiveFontMorphNavigation() {
  return useResolvedFontMorphNavigation(activeDestinationKey)
}
