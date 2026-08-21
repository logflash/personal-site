import { profile } from '../data/site'
import { useHash } from '../hooks/useHashRoute'
import type { Theme } from '../hooks/useTheme'
import { Identity } from './Identity'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'

interface SidebarProps {
  theme: Theme
  onToggleTheme: () => void
}

/**
 * Desktop-only sidebar. The highlighted item follows the hash route (clicks
 * only — never scroll position); no hash means Home.
 */
export function Sidebar({ theme, onToggleTheme }: SidebarProps) {
  const hash = useHash()
  const activeId = hash ? hash.slice(1) : 'home'
  return (
    <aside className="sidebar">
      <div className="identity">
        <Identity />
      </div>
      <nav className="side-nav" aria-label="Primary">
        <NavLinks activeId={activeId} />
      </nav>
      <div className="side-spacer" />
      <div className="side-footer">
        <span>
          © {profile.copyrightYear} {profile.name}
        </span>
        <span className="footer-controls">
          <LocaleSwitcher />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </span>
      </div>
    </aside>
  )
}
