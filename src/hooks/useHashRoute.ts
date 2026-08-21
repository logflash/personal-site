import { useCallback, useEffect, useRef, useState } from 'react'

// Must match the mobile breakpoint in styles/global.css.
const MOBILE_MEDIA_QUERY = '(max-width: 880px)'

function replaceHash(target: string) {
  history.replaceState(null, '', window.location.pathname + window.location.search + target)
  // replaceState doesn't emit hashchange; broadcast so useHash stays in sync.
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** The current location.hash ('#about', ...; '' when unset), as live state. */
export function useHash(): string {
  const [hash, setHash] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  )

  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  return hash
}

/**
 * Mobile only: infers the hash route from the viewport scroll, keeping the
 * URL in sync with the section in view (/#about, /#projects, ...). Any
 * scrolling — user-driven or an in-flight anchor scroll — may move the
 * hash. The home section, including the top of the page, maps to no hash.
 * Uses replaceState so scrolling doesn't flood the history stack.
 *
 * Syncing runs both when the active section changes and on scroll events
 * themselves: a hash set by a pill tap must be cleared when the user
 * scrolls back to the top even if the active section never changed along
 * the way.
 */
export function useMobileHashSync(activeId: string) {
  // At load, the browser may still owe a deep-link jump (e.g. /#projects)
  // while scrollspy reports 'home'; never clear the hash before then. The
  // jump itself is the first scroll event, so it is skipped too.
  const hasScrolled = useRef(false)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  const sync = useCallback(() => {
    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return
    const target = activeIdRef.current === 'home' ? '' : `#${activeIdRef.current}`
    if (target === '' && !hasScrolled.current) return
    if (window.location.hash !== target) replaceHash(target)
  }, [])

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (!hasScrolled.current) {
        hasScrolled.current = true
        return
      }
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        sync()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sync])

  useEffect(() => {
    sync()
  }, [activeId, sync])
}

/**
 * Honors a #section deep link on mount: the app renders after the async
 * i18n boot, so the browser's native anchor jump has already given up by
 * the time the sections exist.
 */
export function useDeepLinkScroll() {
  useEffect(() => {
    if (window.scrollY > 0 || !window.location.hash) return
    const target = document.getElementById(window.location.hash.slice(1))
    target?.scrollIntoView({ behavior: 'instant' })
  }, [])
}

/** Returns a callback that scrolls to the top and clears any #section hash. */
export function useBackToTop() {
  return useCallback(() => {
    window.scrollTo({ top: 0 })
    replaceHash('')
  }, [])
}
