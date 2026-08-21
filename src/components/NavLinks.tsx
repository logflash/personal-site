import { navItems, type NavItem } from '../data/site'

interface NavLinksProps {
  activeId: string
  items?: NavItem[]
}

export function NavLinks({ activeId, items = navItems }: NavLinksProps) {
  return (
    <>
      {items.map(({ id, label }) => (
        <a key={id} href={`#${id}`} className={id === activeId ? 'active' : undefined}>
          {label}
        </a>
      ))}
    </>
  )
}
