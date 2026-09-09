import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
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
