import { Link, getRouteApi, useRouterState } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { navItems, resumeNavItems, type NavItem } from '../data/site'
import { useBackToTop } from '../hooks/useHashRoute'
import { useFontMorphNavigation } from '../hooks/useFontMorphNavigation'
import { resumeHeaderTransition } from '../lib/headerTransitions'
import { translationHash } from '../lib/translationHash'
import { useTranslate } from '../lib/i18n'
import { UndoIcon } from './TransitionPageHeading'

interface NavLinksProps {
  items?: NavItem[]
}

const rootRoute = getRouteApi('__root__')

export function NavLinks({ items }: NavLinksProps) {
  const translate = useTranslate()
  const { locale } = rootRoute.useLoaderData()
  const backToTop = useBackToTop()
  const resumeMorphHandlers = useFontMorphNavigation(resumeHeaderTransition.key)
  const onResumeRoute = useRouterState({
    select: (state) => state.location.pathname.endsWith('/resume'),
  })
  const resolvedItems = items ?? (onResumeRoute ? resumeNavItems : navItems)

  // Home has no hash route: it scrolls to the top of the page and clears
  // any #section hash, like the mobile identity tap.
  const goHome = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    backToTop()
  }

  return (
    <>
      {/* String translations render as bare text, so preserve the source hash
          explicitly for locale-independent gt-rrweb overlays. */}
      {resolvedItems.map(({ id, label }) => {
        const content = translate(label)
        const sharedProps = {
          'data-section': id,
          'data-_gt-hash': translationHash(label),
        }

        if (onResumeRoute && id === 'home') {
          return (
            <Link
              key={id}
              className="resume-home-nav-link"
              to="/$locale"
              params={{ locale }}
              {...resumeMorphHandlers}
              {...sharedProps}
            >
              <span>{content}</span>
              <UndoIcon />
            </Link>
          )
        }

        return onResumeRoute ? (
          <a key={id} href={`#${id}`} {...sharedProps}>
            {content}
          </a>
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
