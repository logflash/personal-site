import { useLocale } from 'gt-react'
import { useEffect } from 'react'
import { localeFromPath, localePath } from '../lib/localePath'

/**
 * Canonicalizes the URL to its locale-prefixed form (/en, /es, /ja): a visit
 * to a bare path gets the resolved locale spliced in without a reload.
 */
export function useCanonicalLocalePath() {
  const locale = useLocale()

  useEffect(() => {
    if (!localeFromPath(window.location.pathname)) {
      history.replaceState(null, '', localePath(locale))
    }
  }, [locale])
}
