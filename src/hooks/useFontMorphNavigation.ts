import { useCallback, useEffect, useMemo, type MouseEvent } from 'react'
import { beginFontMorph, prepareFontMorph } from '../lib/fontMorph'

type KeyResolver = () => string | undefined

function activeDestinationKey() {
  return document.querySelector<HTMLElement>('[data-transition-heading] [data-font-morph]')?.dataset
    .fontMorph
}

function useResolvedFontMorphNavigation(resolveKey: KeyResolver) {
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
      if (key) beginFontMorph(key)
    },
    [resolveKey],
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

export function useFontMorphNavigation(key: string) {
  const resolveKey = useCallback(() => key, [key])
  return useResolvedFontMorphNavigation(resolveKey)
}

/** Resolve the transition from content-authored destination markup at the
 * moment of interaction, keeping route chrome independent of page names. */
export function useActiveFontMorphNavigation() {
  return useResolvedFontMorphNavigation(activeDestinationKey)
}
