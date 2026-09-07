import { createFileRoute, redirect } from '@tanstack/react-router'
import { ContributionGraph } from '../components/ContributionGraph'
import { ContentSection } from '../components/ContentSection'
import { MobileTopBar } from '../components/MobileTopBar'
import { Sidebar } from '../components/Sidebar'
import { profile } from '../data/site'
import { useClearHashAtTop, useDeepLinkScroll } from '../hooks/useHashRoute'
import { useTheme } from '../hooks/useTheme'
import { fetchContributions } from '../lib/contributions'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'
import { localeHead } from '../lib/seo'

export const Route = createFileRoute('/$locale')({
  beforeLoad: ({ params }) => {
    // Unknown first segments land here; send them to the default locale.
    if (!SUPPORTED_LOCALES.includes(params.locale)) {
      throw redirect({ to: '/$locale', params: { locale: DEFAULT_LOCALE } })
    }
  },
  loader: async () => ({ contributions: await fetchContributions() }),
  head: ({ params }) => localeHead(params.locale),
  component: LocalePage,
})

// The whole site is a single page composed of hash-linked sections. The
// hash route changes only through clicks (sidebar, pills, headings, hash
// anchors) plus a reset when the viewport returns to the top; nav
// highlights on all viewports follow the hash.
function LocalePage() {
  const { contributions } = Route.useLoaderData()
  const { toggleTheme } = useTheme()
  useClearHashAtTop()
  useDeepLinkScroll()

  return (
    <div className="layout">
      <Sidebar onToggleTheme={toggleTheme} />
      <div className="content">
        <MobileTopBar onToggleTheme={toggleTheme} />
        <main>
          <ContentSection name="home" />
          <ContributionGraph data={contributions} />
          <ContentSection name="about" />
          <ContentSection name="research" />
          <ContentSection name="projects" />
          <ContentSection name="contact" />
          <div className="copyright-mobile">
            © {profile.copyrightYear} {profile.name}
          </div>
        </main>
      </div>
    </div>
  )
}
