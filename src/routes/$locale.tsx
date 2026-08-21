import { createFileRoute, redirect } from '@tanstack/react-router'
import { ContributionGraph } from '../components/ContributionGraph'
import { MobileTopBar } from '../components/MobileTopBar'
import { Sidebar } from '../components/Sidebar'
import { About } from '../components/sections/About'
import { Contact } from '../components/sections/Contact'
import { Home } from '../components/sections/Home'
import { Projects } from '../components/sections/Projects'
import { Research } from '../components/sections/Research'
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
  const { theme, toggleTheme } = useTheme()
  useClearHashAtTop()
  useDeepLinkScroll()

  return (
    <div className="layout">
      <Sidebar theme={theme} onToggleTheme={toggleTheme} />
      <div className="content">
        <MobileTopBar theme={theme} onToggleTheme={toggleTheme} />
        <main>
          <Home />
          <ContributionGraph data={contributions} />
          <About />
          <Research />
          <Projects />
          <Contact />
          <div className="copyright-mobile">
            © {profile.copyrightYear} {profile.name}
          </div>
        </main>
      </div>
    </div>
  )
}
