import { createRouter } from '@tanstack/react-router'
import { initializeGT } from 'gt-tanstack-start'
import gtConfig from '../gt.config.json'
import loadTranslations from './loadTranslations'
import { routeTree } from './routeTree.gen'

initializeGT({ ...gtConfig, loadTranslations })

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    // Hash-only navigations (sidebar/pill anchor clicks) fire popstate and
    // run through the router; with the default staleness they'd re-run the
    // loaders on every click — re-fetching contributions and rebuilding the
    // translations snapshot, which flickers the page. Loader data here is
    // static per page view, so never re-load within a session; locale
    // switches are full-document navigations (see LocaleSwitcher).
    defaultStaleTime: Infinity,
  })
}
