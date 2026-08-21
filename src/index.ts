// gt-react SPA bootstrap: translations must be initialized before any app
// module evaluates, so module-level t() calls (src/data/site.ts) resolve in
// the active locale. Dev-mode hot translation reads VITE_GT_PROJECT_ID and
// VITE_GT_DEV_API_KEY from the environment automatically.
//
// Locale-prefixed routing (/en, /es, /ja): the URL is the source of truth.
// The resolved locale is mirrored into gt-react's cookie before init (its
// live locale reads put the cookie first), and on a locale switch _reload
// navigates to the new prefix instead of reloading in place. A bare path is
// canonicalized after mount by useCanonicalLocalePath.
import { initializeGTSPA } from 'gt-react'
import gtConfig from '../gt.config.json'
import { localePath, persistLocaleCookie, resolveInitialLocale } from './lib/localePath'
import loadTranslations from './loadTranslations'

const locale = resolveInitialLocale()
persistLocaleCookie(locale)

await initializeGTSPA({
  ...gtConfig,
  loadTranslations,
  locale,
  _reload: (state) => {
    window.location.href = localePath(state.locale)
  },
})

await import('./main')
