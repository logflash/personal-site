import { Link, getRouteApi } from '@tanstack/react-router'
import { useContext, type MouseEvent } from 'react'
import { SitePageContext } from './SitePageContext'
import { navItems, pageNavItems, type NavItem } from '../data/site'
import { useBackToTop } from '../hooks/useHashRoute'
import {
  useActiveFontMorphNavigation,
  useFontMorphNavigation,
} from '../hooks/useFontMorphNavigation'
import { morphSourceKey, type FontMorphCause } from '../lib/fontMorphCause'
import { translationHash } from '../lib/translationHash'
import { useTranslate } from '../lib/i18n'
import { UndoIcon } from './TransitionPageHeading'

interface NavLinksProps {
  items?: NavItem[]
  surface?: 'sidebar' | 'topbar'
}

const rootRoute = getRouteApi('__root__')

function PageNavLink({ item, surface }: { item: NavItem; surface: FontMorphCause }) {
  const { locale } = rootRoute.useLoaderData()
  const translate = useTranslate()
  const active = useContext(SitePageContext) === item.id
  const key = item.transition!
  const handlers = useFontMorphNavigation(key, surface)
  return (
    <Link
      to={item.to!}
      params={{ locale }}
      data-page-link={item.id}
      aria-current={active ? 'page' : undefined}
      activeProps={{ 'aria-current': active ? 'page' : undefined }}
      {...handlers}
      onClick={active ? (event) => event.preventDefault() : handlers.onClick}
    >
      <span
        data-font-morph={active ? undefined : morphSourceKey(key, surface)}
        data-_gt-hash={translationHash(item.label)}
      >
        {translate(item.label)}
      </span>
    </Link>
  )
}

export function NavLinks({ items, surface = 'sidebar' }: NavLinksProps) {
  const translate = useTranslate()
  const { locale } = rootRoute.useLoaderData()
  const backToTop = useBackToTop()
  const activeMorphHandlers = useActiveFontMorphNavigation()
  const page = useContext(SitePageContext)
  const pageItems = pageNavItems(`/${page}`)
  const onHomeRoute = page === 'home'
  const resolvedItems =
    items ?? pageItems ?? (onHomeRoute ? navItems : navItems.filter((item) => !item.to))

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
      {resolvedItems.map((item) => {
        const { id, label } = item
        if (item.to) return <PageNavLink key={id} item={item} surface={surface} />
        const content = translate(label)
        const sharedProps = {
          'data-section': id,
          'data-_gt-hash': translationHash(label),
        }

        if (pageItems && id === 'home') {
          return (
            <Link
              key={id}
              className="resume-home-nav-link"
              to="/$locale"
              activeOptions={{ exact: true }}
              params={{ locale }}
              {...activeMorphHandlers}
              {...sharedProps}
            >
              <span>{content}</span>
              <UndoIcon />
            </Link>
          )
        }

        if (!pageItems && !onHomeRoute) {
          return (
            <Link
              key={id}
              to="/$locale"
              params={{ locale }}
              hash={id === 'home' ? undefined : id}
              {...sharedProps}
            >
              {content}
            </Link>
          )
        }

        return pageItems ? (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === page ? 'page' : undefined}
            onClick={id === page ? goHome : undefined}
            {...sharedProps}
          >
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
