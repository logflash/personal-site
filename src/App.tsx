import { ContributionGraph } from './components/ContributionGraph'
import { MobileTopBar } from './components/MobileTopBar'
import { Sidebar } from './components/Sidebar'
import { About } from './components/sections/About'
import { Contact } from './components/sections/Contact'
import { Home } from './components/sections/Home'
import { Projects } from './components/sections/Projects'
import { Research } from './components/sections/Research'
import { navItems, profile } from './data/site'
import { useDeepLinkScroll, useMobileHashSync } from './hooks/useHashRoute'
import { useCanonicalLocalePath } from './hooks/useLocalePath'
import { useScrollSpy } from './hooks/useScrollSpy'
import { useTheme } from './hooks/useTheme'

const SECTION_IDS = navItems.map((item) => item.id)

// The whole site is a single page composed of hash-linked sections.
export default function App() {
  const { theme, toggleTheme } = useTheme()
  const activeId = useScrollSpy(SECTION_IDS)
  useMobileHashSync(activeId)
  useCanonicalLocalePath()
  useDeepLinkScroll()

  return (
    <div className="layout">
      <Sidebar activeId={activeId} theme={theme} onToggleTheme={toggleTheme} />
      <div className="content">
        <MobileTopBar theme={theme} onToggleTheme={toggleTheme} />
        <main>
          <Home />
          <ContributionGraph />
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
