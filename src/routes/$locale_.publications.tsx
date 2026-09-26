import { createFileRoute, redirect } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'
import { SiteShell } from '../components/SiteShell'
import { pageMdxComponents } from '../components/mdx/MdxContent'
import PublicationsContent from '../content/Publications.mdx'
import { useClearHashAtTop, useDeepLinkScroll } from '../hooks/useHashRoute'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'
import { localeHead } from '../lib/seo'

export const Route = createFileRoute('/$locale_/publications')({
  beforeLoad: ({ params }) => {
    if (!SUPPORTED_LOCALES.includes(params.locale)) {
      throw redirect({ to: '/$locale/publications', params: { locale: DEFAULT_LOCALE } })
    }
  },
  head: ({ params }) => localeHead(params.locale, 'publications'),
  component: PublicationsPage,
})

function PublicationsPage() {
  useClearHashAtTop()
  useDeepLinkScroll()
  useLayoutEffect(() => {
    document.documentElement.dataset.activeSection = window.location.hash.slice(1) || 'publications'
    return () => {
      document.documentElement.dataset.activeSection = 'home'
    }
  }, [])
  return (
    <SiteShell page="publications" mainClassName="resume-page collection-page">
      <PublicationsContent components={pageMdxComponents} />
    </SiteShell>
  )
}
