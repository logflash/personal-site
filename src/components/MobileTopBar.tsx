import type { MouseEvent } from 'react'
import { mobileNavItems } from '../data/site'
import { useBackToTop } from '../hooks/useHashRoute'
import { Identity } from './Identity'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'

interface MobileTopBarProps {
  onToggleTheme: () => void
}

/**
 * Mobile-only top bar + pill nav. The selected pill
 * follows the hash route directly — a tap highlights immediately, and no
 * pill is selected while the page is at the top (no hash).
 */
export function MobileTopBar({ onToggleTheme }: MobileTopBarProps) {
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
        <LocaleSwitcher />
        <ThemeToggle onToggle={onToggleTheme} />
      </header>
      <nav className="pill-nav" aria-label="Primary">
        <NavLinks items={mobileNavItems} />
      </nav>
    </div>
  )
}
