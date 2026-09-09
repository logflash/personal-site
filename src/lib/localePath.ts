import gtConfig from '../../gt.config.json'

export const DEFAULT_LOCALE: string = gtConfig.defaultLocale
export const SUPPORTED_LOCALES: string[] = [gtConfig.defaultLocale, ...gtConfig.locales]
export const LOCALE_NATIVE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  ja: '日本語',
}

/** '/es' or '/es#about' → 'es'; null when the path has no locale prefix. */
export function localeFromPath(pathname: string): string | null {
  const first = pathname.split('/')[1]
  return SUPPORTED_LOCALES.includes(first) ? first : null
}

/** Replaces only the locale prefix while preserving the locale-independent route. */
export function pathnameForLocale(pathname: string, locale: string): string {
  const currentLocale = localeFromPath(pathname)
  if (!currentLocale) return `/${locale}${pathname === '/' ? '' : pathname}`
  return `/${locale}${pathname.slice(currentLocale.length + 1)}`
}

/**
 * Mirrors an explicit locale choice into GT's conventional cookie so a later
 * visit to the bare `/` redirects to the locale the visitor picked last.
 */
export function persistLocaleCookie(locale: string) {
  document.cookie = `generaltranslation.locale=${locale}; path=/; max-age=31536000`
}
