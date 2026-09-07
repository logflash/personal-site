import { useMessages } from 'gt-react'
import type { MouseEvent } from 'react'
import { navItems, type NavItem } from '../data/site'
import { useBackToTop } from '../hooks/useHashRoute'
import { translationHash } from '../lib/translationHash'

interface NavLinksProps {
  items?: NavItem[]
}

export function NavLinks({ items = navItems }: NavLinksProps) {
  const m = useMessages()
  const backToTop = useBackToTop()

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
      {items.map(({ id, label }) => (
        <a
          key={id}
          href={id === 'home' ? '/' : `#${id}`}
          data-section={id}
          data-_gt-hash={translationHash(label)}
          onClick={id === 'home' ? goHome : undefined}
        >
          {m(label)}
        </a>
      ))}
    </>
  )
}
