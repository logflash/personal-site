import { useRouterState } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'
import MissingContent from '../content/Missing.mdx'
import { sanitizeDisplayPath } from '../lib/sanitizeDisplayPath'
import { SiteShell } from './SiteShell'
import { sharedMdxComponents } from './mdx/MdxContent'

export function NotFoundPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.activeSection = 'not-found'

    return () => {
      root.dataset.activeSection = 'home'
    }
  }, [])

  return (
    <SiteShell mainClassName="not-found-page">
      <title>Page not found — Ian Henriques</title>
      <meta name="robots" content="noindex" />
      <div className="not-found-frame">
        <div className="not-found-code" aria-hidden="true">
          404
        </div>
        <div className="not-found-path">{sanitizeDisplayPath(pathname)}</div>
        <MissingContent components={sharedMdxComponents} />
      </div>
    </SiteShell>
  )
}
