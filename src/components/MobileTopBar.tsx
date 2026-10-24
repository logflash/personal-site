import { Link, getRouteApi } from '@tanstack/react-router'
import { useContext } from 'react'
import { SitePageContext } from './SitePageContext'
import { mobileNavItems, pageNavItems } from '../data/site'
import { useActiveFontMorphNavigation } from '../hooks/useFontMorphNavigation'
import { Identity } from './Identity'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'
import { SITE_URL } from '../lib/seo'

interface MobileTopBarProps {
  onToggleTheme: () => void
  suppressLocaleInteraction?: boolean
}

const rootRoute = getRouteApi('__root__')

/**
 * Mobile-only top bar + pill nav. The selected pill
 * follows the hash route directly — a tap highlights immediately, and no
 * pill is selected while the page is at the top (no hash).
 */
export function MobileTopBar({ onToggleTheme, suppressLocaleInteraction }: MobileTopBarProps) {
  const { locale } = rootRoute.useLoaderData()
  const activeMorphHandlers = useActiveFontMorphNavigation()
  const page = useContext(SitePageContext)
  const pageItems = pageNavItems(`/${page}`)
  const items = pageItems
    ? pageItems.filter((item) => item.id !== 'home')
    : page === 'home'
      ? mobileNavItems
      : mobileNavItems.filter((item) => !item.to)
  return (
    <div className="mobile-top">
      <header className="mobile-header">
        <div className="identity-link">
          <Identity
            renderWho={(who) => (
              <Link
                className="identity-text-link"
                to="/$locale"
                params={{ locale }}
                {...activeMorphHandlers}
              >
                {who}
              </Link>
            )}
          />
        </div>
        <div className="spacer" />
        {page === 'resume' && (
          <div className="print-contact">
            <span>ian [at] ianlh [dot] com</span>
            <a href={SITE_URL}>{new URL(SITE_URL).hostname}</a>
          </div>
        )}
        <LocaleSwitcher suppressInteraction={suppressLocaleInteraction} />
        <ThemeToggle onToggle={onToggleTheme} />
      </header>
      {items.length > 0 && (
        <nav className="pill-nav" aria-label="Primary">
          <NavLinks items={items} surface="topbar" />
        </nav>
      )}
    </div>
  )
}
