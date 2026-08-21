import { profile } from '../data/site'
import type { Theme } from '../hooks/useTheme'
import { Identity } from './Identity'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'

interface SidebarProps {
  activeId: string
  theme: Theme
  onToggleTheme: () => void
}

/** Desktop-only sidebar. */
export function Sidebar({ activeId, theme, onToggleTheme }: SidebarProps) {
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
