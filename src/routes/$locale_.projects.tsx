import { createFileRoute, redirect } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'
import { SiteShell } from '../components/SiteShell'
import { ProjectStarsContext } from '../components/ProjectStarsContext'
import { pageMdxComponents } from '../components/mdx/MdxContent'
import ProjectsContent from '../content/Projects.mdx'
import { useClearHashAtTop, useDeepLinkScroll } from '../hooks/useHashRoute'
import { fetchGitHubStats } from '../lib/githubStats'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'
import { localeHead } from '../lib/seo'

export const Route = createFileRoute('/$locale_/projects')({
  beforeLoad: ({ params }) => {
    if (!SUPPORTED_LOCALES.includes(params.locale)) {
      throw redirect({ to: '/$locale/projects', params: { locale: DEFAULT_LOCALE } })
    }
  },
  loader: () => fetchGitHubStats(),
  head: ({ params }) => localeHead(params.locale, 'projects'),
  component: ProjectsPage,
})

function ProjectsPage() {
  const { projectStars } = Route.useLoaderData()
  useClearHashAtTop()
  useDeepLinkScroll()
  useLayoutEffect(() => {
    document.documentElement.dataset.activeSection = window.location.hash.slice(1) || 'projects'
    return () => {
      document.documentElement.dataset.activeSection = 'home'
    }
  }, [])
  return (
    <SiteShell page="projects" mainClassName="resume-page collection-page">
      <ProjectStarsContext.Provider value={projectStars}>
        <ProjectsContent components={pageMdxComponents} />
      </ProjectStarsContext.Provider>
    </SiteShell>
  )
}
