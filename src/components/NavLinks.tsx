import { useMessages } from 'gt-react'
import { navItems, type NavItem } from '../data/site'

interface NavLinksProps {
  activeId: string
  items?: NavItem[]
}

export function NavLinks({ activeId, items = navItems }: NavLinksProps) {
  const m = useMessages()
  return (
    <>
      {items.map(({ id, label }) => (
        <a key={id} href={`#${id}`} className={id === activeId ? 'active' : undefined}>
          {m(label)}
        </a>
      ))}
    </>
  )
}
