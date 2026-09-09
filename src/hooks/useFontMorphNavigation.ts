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
