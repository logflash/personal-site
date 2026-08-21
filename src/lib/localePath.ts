import gtConfig from '../../gt.config.json'

export const DEFAULT_LOCALE: string = gtConfig.defaultLocale
export const SUPPORTED_LOCALES: string[] = [gtConfig.defaultLocale, ...gtConfig.locales]

/** '/es' or '/es#about' → 'es'; null when the path has no locale prefix. */
export function localeFromPath(pathname: string): string | null {
  const first = pathname.split('/')[1]
  return SUPPORTED_LOCALES.includes(first) ? first : null
}

/**
 * Mirrors an explicit locale choice into gt-react's cookie so a later visit
 * to the bare `/` redirects to the locale the visitor picked last.
 */
export function persistLocaleCookie(locale: string) {
  document.cookie = `generaltranslation.locale=${locale}; path=/; max-age=31536000`
}
