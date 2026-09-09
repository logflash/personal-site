import { Link, getRouteApi, useRouterState } from '@tanstack/react-router'
import { mobileNavItems } from '../data/site'
import { useFontMorphNavigation } from '../hooks/useFontMorphNavigation'
import { resumeHeaderTransition } from '../lib/headerTransitions'
import { Identity } from './Identity'
import { LocaleSwitcher } from './LocaleSwitcher'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'

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
  const resumeMorphHandlers = useFontMorphNavigation(resumeHeaderTransition.key)
  const onResumeRoute = useRouterState({
    select: (state) => state.location.pathname.endsWith('/resume'),
  })
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
                {...(onResumeRoute ? resumeMorphHandlers : {})}
              >
                {who}
              </Link>
            )}
          />
        </div>
        <div className="spacer" />
        <LocaleSwitcher suppressInteraction={suppressLocaleInteraction} />
        <ThemeToggle onToggle={onToggleTheme} />
      </header>
      <nav className="pill-nav" aria-label="Primary">
        <NavLinks items={mobileNavItems} />
      </nav>
    </div>
  )
}
