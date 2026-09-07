import { profile } from '../data/site'
import { Identity } from './Identity'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'

interface SidebarProps {
  onToggleTheme: () => void
}

/**
 * Desktop-only sidebar. The highlighted item follows the hash route (clicks
 * only — never scroll position); no hash means Home.
 */
export function Sidebar({ onToggleTheme }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="identity">
        <Identity />
      </div>
      <nav className="side-nav" aria-label="Primary">
        <NavLinks />
      </nav>
      <div className="side-spacer" />
      <div className="side-footer">
        <span>
          © {profile.copyrightYear} {profile.name}
        </span>
        <span className="footer-controls">
          <LocaleSwitcher />
          <ThemeToggle onToggle={onToggleTheme} />
        </span>
      </div>
    </aside>
  )
}
