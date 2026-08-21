import { useMessages } from 'gt-react'
import type { MouseEvent } from 'react'
import { navItems, type NavItem } from '../data/site'
import { useBackToTop } from '../hooks/useHashRoute'

interface NavLinksProps {
  activeId: string
  items?: NavItem[]
}

export function NavLinks({ activeId, items = navItems }: NavLinksProps) {
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
      {items.map(({ id, label }) => (
        <a
          key={id}
          href={id === 'home' ? '/' : `#${id}`}
          className={id === activeId ? 'active' : undefined}
          onClick={id === 'home' ? goHome : undefined}
        >
          {m(label)}
        </a>
      ))}
    </>
  )
}
