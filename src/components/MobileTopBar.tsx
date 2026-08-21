import { LocaleSelector } from 'gt-react'
import type { MouseEvent } from 'react'
import { mobileNavItems } from '../data/site'
import { useBackToTop, useHash } from '../hooks/useHashRoute'
import type { Theme } from '../hooks/useTheme'
import { Identity } from './Identity'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'

interface MobileTopBarProps {
  theme: Theme
  onToggleTheme: () => void
}

/**
 * Mobile-only top bar + pill nav. The selected pill
 * follows the hash route directly — a tap highlights immediately, and no
 * pill is selected while the page is at the top (no hash).
 */
export function MobileTopBar({ theme, onToggleTheme }: MobileTopBarProps) {
  const hash = useHash()
  const backToTop = useBackToTop()

  // Back to the top-level route: scroll up and clear any #section hash.
  const goHome = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    backToTop()
  }

  return (
    <div className="mobile-top">
      <header className="mobile-header">
        <a className="identity-link" href="/" onClick={goHome}>
          <Identity />
        </a>
        <div className="spacer" />
        <LocaleSelector />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>
      <nav className="pill-nav" aria-label="Primary">
        <NavLinks activeId={hash.slice(1)} items={mobileNavItems} />
      </nav>
    </div>
  )
}
