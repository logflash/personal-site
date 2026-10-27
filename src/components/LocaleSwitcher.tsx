import { useRouterState } from '@tanstack/react-router'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import loadTranslations from '../loadTranslations'
import { useLocale } from '../lib/i18n'
import { rememberLanguagePosition } from '../lib/pageMemory'
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  pathnameForLocale,
  persistLocaleCookie,
} from '../lib/localePath'

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
  const location = useRouterState({ select: (state) => state.location })
  const [urlSuffix, setUrlSuffix] = useState(location.searchStr)
  const [open, setOpen] = useState(false)
  const expanded = open && !suppressInteraction
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<number | null>(null)
  const optionsId = useId()
  const prefetchScheduled = useRef(false)

  const focusOption = (index: number) => {
    rootRef.current?.querySelectorAll<HTMLAnchorElement>('[data-locale]')[index]?.focus()
  }

  const openMenu = () => {
    // URL fragments aren't available during SSR, and reading-position history
    // updates can happen outside the router. Capture the live URL when opening.
    setUrlSuffix(`${window.location.search}${window.location.hash}`)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (expanded && pendingFocus.current !== null) focusOption(pendingFocus.current)
    pendingFocus.current = null
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      // Safari need not focus a button on pointer activation, so Escape must
      // also work when focus stayed outside this disclosure.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded])

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

    // Let the pointer/focus event finish so the menu paints before module
    // imports and document prefetching begin.
    window.setTimeout(prefetchAlternateLocales, 0)
  }

  const changeLocale = (next: string, href?: string) => {
    if (suppressInteraction || next === locale) return
    rememberLanguagePosition(pathnameForLocale(window.location.pathname, next))
    persistLocaleCookie(next)
    window.location.href =
      href ??
      `${pathnameForLocale(window.location.pathname, next)}${window.location.search}${window.location.hash}`
  }

  return (
    <span
      ref={rootRef}
      className="locale-switcher"
      inert={suppressInteraction ? true : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (suppressInteraction || event.target instanceof HTMLSelectElement) return
        const options = [...(rootRef.current?.querySelectorAll('[data-locale]') ?? [])]
        const current = options.indexOf(event.target as Element)
        let next: number
        if (event.key === 'ArrowDown') next = (current + 1) % options.length
        else if (event.key === 'ArrowUp')
          next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length
        else if (expanded && event.key === 'Home') next = 0
        else if (expanded && event.key === 'End') next = options.length - 1
        else return
        event.preventDefault()
        if (expanded) focusOption(next)
        else {
          pendingFocus.current = event.key === 'ArrowUp' ? options.length - 1 : 0
          openMenu()
        }
      }}
    >
      <select
        className="locale-switcher-native"
        aria-label="Language"
        aria-disabled={suppressInteraction || undefined}
        tabIndex={suppressInteraction ? -1 : undefined}
        value={locale}
        onPointerDown={() => !suppressInteraction && scheduleAlternateLocalePrefetch()}
        onFocus={() => {
          setOpen(false)
          if (!suppressInteraction) scheduleAlternateLocalePrefetch()
        }}
        onChange={(event) => changeLocale(event.target.value)}
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NATIVE_NAMES[code] ?? code}
          </option>
        ))}
      </select>
      <button
        ref={triggerRef}
        type="button"
        className="locale-switcher-trigger"
        aria-label={`Language: ${LOCALE_NATIVE_NAMES[locale] ?? locale}`}
        aria-expanded={expanded}
        aria-controls={optionsId}
        aria-disabled={suppressInteraction || undefined}
        tabIndex={suppressInteraction ? -1 : undefined}
        onPointerDown={() => !suppressInteraction && scheduleAlternateLocalePrefetch()}
        onFocus={() => !suppressInteraction && scheduleAlternateLocalePrefetch()}
        onClick={() => {
          if (suppressInteraction) return
          if (expanded) setOpen(false)
          else openMenu()
        }}
      >
        {LOCALE_NATIVE_NAMES[locale] ?? locale}
      </button>
      <span
        id={optionsId}
        className="locale-switcher-options"
        role="navigation"
        aria-label="Language"
        hidden={!expanded}
      >
        {SUPPORTED_LOCALES.map((code) => (
          <a
            key={code}
            className="locale-switcher-option"
            data-locale={code}
            lang={code}
            href={`${pathnameForLocale(location.pathname, code)}${urlSuffix}`}
            aria-current={code === locale ? 'true' : undefined}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return
              event.preventDefault()
              if (suppressInteraction) return
              if (code === locale) {
                setOpen(false)
                triggerRef.current?.focus()
                return
              }
              changeLocale(code, event.currentTarget.href)
            }}
          >
            {LOCALE_NATIVE_NAMES[code] ?? code}
          </a>
        ))}
      </span>
    </span>
  )
}
