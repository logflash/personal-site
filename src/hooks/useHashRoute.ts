import { useCallback, useEffect, useState } from 'react'

function replaceHash(target: string) {
  history.replaceState(null, '', window.location.pathname + window.location.search + target)
  // replaceState doesn't emit hashchange; broadcast so useHash stays in sync.
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** The current location.hash ('#about', ...; '' when unset), as live state. */
export function useHash(): string {
  // Starts empty to match SSR output — the fragment is client-only knowledge
  // (browsers don't send it to servers), so it must be applied after
  // hydration or React silently keeps the server's inactive markup.
  const [hash, setHash] = useState('')

  useEffect(() => {
    const update = () => setHash(window.location.hash)
    update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  return hash
}

/**
 * Clears the #section hash when the viewport reaches the very top of the
 * page (restoring Home as the highlighted nav item). This is the sole
 * scroll-driven hash update — the hash otherwise changes only through
 * explicit navigation (sidebar/pill/heading clicks, back-to-top).
 */
export function useClearHashAtTop() {
  useEffect(() => {
    let ticking = false
    const update = () => {
      ticking = false
      if (window.scrollY > 0 || window.location.hash === '') return
      replaceHash('')
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}

/**
 * Honors a #section deep link on mount: the app renders after the async
 * i18n boot, so the browser's native anchor jump has already given up by
 * the time the sections exist.
 */
export function useDeepLinkScroll() {
  useEffect(() => {
    if (window.scrollY > 0 || !window.location.hash) return
    // '#home' means the top of the page — a fresh load is already there,
    // so scrolling to the section's offset would only shift the view down.
    if (window.location.hash === '#home') return
    const target = document.getElementById(window.location.hash.slice(1))
    target?.scrollIntoView({ behavior: 'instant' })
  }, [])
}

/** Returns a callback that scrolls to the top and clears any #section hash. */
export function useBackToTop() {
  return useCallback(() => {
    window.scrollTo({ top: 0 })
    // While recording (gt-rrweb capture), the document column scrolls inside
    // the fixed frame instead of the window; reset it too.
    document.querySelector('.content')?.scrollTo({ top: 0 })
    replaceHash('')
  }, [])
}
