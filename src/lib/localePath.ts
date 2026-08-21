import gtConfig from '../../gt.config.json'

export const SUPPORTED_LOCALES: string[] = [gtConfig.defaultLocale, ...gtConfig.locales]

/** '/es#about' → 'es'; null when the path has no locale prefix. */
export function localeFromPath(pathname: string): string | null {
  const first = pathname.split('/')[1]
  return SUPPORTED_LOCALES.includes(first) ? first : null
}

/** Path for a locale, keeping the current query and #section hash. */
export function localePath(locale: string): string {
  return `/${locale}${window.location.search}${window.location.hash}`
}

const GT_LOCALE_COOKIE = 'generaltranslation.locale'

/**
 * Locale for the current visit: the path prefix wins; a bare path falls back
 * to the locale gt-react persisted on the last explicit switch (its cookie),
 * then to browser languages, then to the default.
 */
export function resolveInitialLocale(): string {
  const fromPath = localeFromPath(window.location.pathname)
  if (fromPath) return fromPath

  const cookie = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${GT_LOCALE_COOKIE.replace('.', '\\.')}=([\\w-]+)`),
  )?.[1]
  if (cookie && SUPPORTED_LOCALES.includes(cookie)) return cookie

  for (const lang of navigator.languages ?? []) {
    if (SUPPORTED_LOCALES.includes(lang)) return lang
    const base = lang.split('-')[0]
    if (SUPPORTED_LOCALES.includes(base)) return base
  }
  return gtConfig.defaultLocale
}

/**
 * gt-react's live locale reads consult its cookie before any override, so
 * the URL's locale must be mirrored into the cookie before initializeGTSPA —
 * otherwise a stale cookie from an earlier visit beats the path prefix.
 */
export function persistLocaleCookie(locale: string) {
  document.cookie = `${GT_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000`
}
