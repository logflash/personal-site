import { getLocaleProperties, useLocale } from 'gt-react'
import { useRef } from 'react'
import loadTranslations from '../loadTranslations'
import { SUPPORTED_LOCALES, pathnameForLocale, persistLocaleCookie } from '../lib/localePath'

const prefetchedDocuments = new Set<string>()

function prefetchDocument(href: string) {
  if (prefetchedDocuments.has(href)) return
  prefetchedDocuments.add(href)

  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.as = 'document'
  link.href = href
  document.head.append(link)
}

/**
 * Locale picker for the path-prefixed routing (/en, /es, /ja). Switching is
 * a full-document navigation: the new locale's page is server-rendered (and
 * CDN-cached), and it keeps the router free to never re-run loaders within
 * a page view (see router.tsx). The cookie makes the bare `/` remember the
 * choice on the next visit.
 */
export function LocaleSwitcher({ suppressInteraction = false }: { suppressInteraction?: boolean }) {
  const locale = useLocale()
  const prefetchScheduled = useRef(false)

  const prefetchAlternateLocales = () => {
    for (const alternate of SUPPORTED_LOCALES) {
      if (alternate === locale) continue

      // Warm the exact JSON chunk used by GT after the navigation and the
      // SSR document for the same locale-independent route.
      void loadTranslations(alternate).catch(() => {})
      prefetchDocument(
        `${pathnameForLocale(window.location.pathname, alternate)}${window.location.search}`,
      )
    }
  }

  const scheduleAlternateLocalePrefetch = () => {
    if (prefetchScheduled.current) return
    prefetchScheduled.current = true

    // Let the pointer/focus event finish so the browser can open and paint its
    // native select UI before module imports and document prefetching begin.
    window.setTimeout(prefetchAlternateLocales, 0)
  }

  return (
    <select
      className="locale-switcher"
      aria-label="Language"
      aria-disabled={suppressInteraction || undefined}
      inert={suppressInteraction ? true : undefined}
      tabIndex={suppressInteraction ? -1 : undefined}
      value={locale}
      onPointerDown={(event) => {
        if (suppressInteraction) {
          event.preventDefault()
          return
        }
        scheduleAlternateLocalePrefetch()
      }}
      onFocus={(event) => {
        if (suppressInteraction) {
          event.currentTarget.blur()
          return
        }
        scheduleAlternateLocalePrefetch()
      }}
      onChange={(event) => {
        if (suppressInteraction) return
        const next = event.target.value
        persistLocaleCookie(next)
        window.location.href = `${pathnameForLocale(window.location.pathname, next)}${window.location.search}${window.location.hash}`
      }}
    >
      {SUPPORTED_LOCALES.map((code) => (
        <option key={code} value={code}>
          {getLocaleProperties(code).nativeName}
        </option>
      ))}
    </select>
  )
}
