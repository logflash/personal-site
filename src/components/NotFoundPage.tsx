import { useRouterState } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'
import MissingContent from '../content/Missing.mdx'
import { sanitizeDisplayPath } from '../lib/sanitizeDisplayPath'
import { SiteShell } from './SiteShell'
import { sharedMdxComponents } from './mdx/MdxContent'
import { NotFoundExperiment } from './NotFoundExperiment'

export function NotFoundPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const experiment = import.meta.env.DEV && new URLSearchParams(search).get('preview') === '404'

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.activeSection = 'not-found'

    return () => {
      root.dataset.activeSection = 'home'
    }
  }, [])

  return (
    <SiteShell page="not-found" mainClassName="not-found-page">
      <title>Page not found — Ian Henriques</title>
      <meta name="robots" content="noindex" />
      <div className={`not-found-frame${experiment ? ' not-found-experiment' : ''}`}>
        <div className="not-found-path">{sanitizeDisplayPath(pathname)}</div>
        {experiment && <NotFoundExperiment />}
        <MissingContent components={sharedMdxComponents} />
      </div>
    </SiteShell>
  )
}
