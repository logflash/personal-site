import { Link, getRouteApi, useRouterState } from '@tanstack/react-router'
import { useMessages } from 'gt-react'
import type { MouseEvent } from 'react'
import { navItems, type NavItem } from '../data/site'
import { useBackToTop } from '../hooks/useHashRoute'
import { useFontMorphNavigation } from '../hooks/useFontMorphNavigation'
import { translationHash } from '../lib/translationHash'

interface NavLinksProps {
  items?: NavItem[]
}

const rootRoute = getRouteApi('__root__')

export function NavLinks({ items = navItems }: NavLinksProps) {
  const m = useMessages()
  const { locale } = rootRoute.useLoaderData()
  const backToTop = useBackToTop()
  const resumeMorphHandlers = useFontMorphNavigation('resume-title')
  const onResumeRoute = useRouterState({
    select: (state) => state.location.pathname.endsWith('/resume'),
  })

  // Home has no hash route: it scrolls to the top of the page and clears
  // any #section hash, like the mobile identity tap.
  const goHome = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    backToTop()
  }

  return (
    <>
      {/* useMessages renders bare translated text, so preserve the source hash
          explicitly for locale-independent gt-rrweb overlays. */}
      {items.map(({ id, label }) => {
        const content = m(label)
        const sharedProps = {
          'data-section': id,
          'data-_gt-hash': translationHash(label),
        }

        return onResumeRoute ? (
          <Link
            key={id}
            to="/$locale"
            params={{ locale }}
            hash={id === 'home' ? undefined : id}
            {...resumeMorphHandlers}
            {...sharedProps}
          >
            {content}
          </Link>
        ) : (
          <a
            key={id}
            href={id === 'home' ? '/' : `#${id}`}
            onClick={id === 'home' ? goHome : undefined}
            {...sharedProps}
          >
            {content}
          </a>
        )
      })}
    </>
  )
}
