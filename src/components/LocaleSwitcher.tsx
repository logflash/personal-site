import { useLocation, useNavigate } from '@tanstack/react-router'
import { getLocaleProperties, useLocale } from 'gt-react'
import { SUPPORTED_LOCALES, persistLocaleCookie } from '../lib/localePath'

/**
 * Locale picker for the path-prefixed routing (/en, /es, /ja): switching
 * navigates to the same page under the new prefix and remembers the choice
 * in gt-react's cookie so the bare `/` redirects there next visit.
 */
export function LocaleSwitcher() {
  const locale = useLocale()
  const navigate = useNavigate()
  const { hash } = useLocation()

  return (
    <select
      className="locale-switcher"
      aria-label="Language"
      value={locale}
      onChange={(event) => {
        const next = event.target.value
        persistLocaleCookie(next)
        navigate({ to: '/$locale', params: { locale: next }, hash })
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
