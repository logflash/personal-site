import { createRouter } from '@tanstack/react-router'
import { createIsomorphicFn, getGlobalStartContext } from '@tanstack/react-start'
import { CSP_NONCE_META_SELECTOR } from './lib/security'
import { routeTree } from './routeTree.gen'

const getCspNonce = createIsomorphicFn()
  .server(() => (getGlobalStartContext() as { cspNonce?: string } | undefined)?.cspNonce)
  .client(() => document.querySelector<HTMLMetaElement>(CSP_NONCE_META_SELECTOR)?.content)

export function getRouter() {
  return createRouter({
    routeTree,
    ssr: { nonce: getCspNonce() },
    defaultPreload: 'intent',
    // Hash-only navigations (sidebar/pill anchor clicks) fire popstate and
    // run through the router; with the default staleness they'd re-run the
    // loaders on every click — re-fetching contributions and rebuilding the
    // translations snapshot, which flickers the page. Loader data here is
    // static per page view, so never re-load within a session. Locale
    // switches stay full-document navigations whose target document and
    // translation chunk are prefetched on selector interaction.
    defaultStaleTime: Infinity,
  })
}
