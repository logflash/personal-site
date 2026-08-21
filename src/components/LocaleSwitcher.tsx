import { getLocaleProperties, useLocale } from 'gt-react'
import { SUPPORTED_LOCALES, persistLocaleCookie } from '../lib/localePath'

/**
 * Locale picker for the path-prefixed routing (/en, /es, /ja). Switching is
 * a full-document navigation: the new locale's page is server-rendered (and
 * CDN-cached), and it keeps the router free to never re-run loaders within
 * a page view (see router.tsx). The cookie makes the bare `/` remember the
 * choice on the next visit.
 */
export function LocaleSwitcher() {
  const locale = useLocale()

  return (
    <select
      className="locale-switcher"
      aria-label="Language"
      value={locale}
      onChange={(event) => {
        const next = event.target.value
        persistLocaleCookie(next)
        window.location.href = `/${next}${window.location.search}${window.location.hash}`
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
