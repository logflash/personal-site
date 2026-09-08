import { useCallback, useEffect, useMemo, type MouseEvent } from 'react'
import { beginFontMorph, prepareFontMorph } from '../lib/fontMorph'

export function useFontMorphNavigation(key: string) {
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
      beginFontMorph(key)
    },
    [key],
  )
  const prepare = useCallback(() => {
    void prepareFontMorph(key).catch(() => undefined)
  }, [key])

  useEffect(() => {
    // Fetch/parse the outline faces and run KUTE's contour correspondence as
    // soon as the initial page has become interactive. This is intentionally
    // idle work: it removes preparation from the click path without delaying
    // first paint or hydration.
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
