// Identity and navigation stay in TypeScript because they are shared by page
// chrome, route metadata, and server loaders. Long-form page copy lives in
// src/content/*.mdx.
import { msg } from 'gt-react'

export interface NavItem {
  id: string
  label: string
}

export const profile = {
  name: 'Ian Henriques',
  handle: '@logflash',
  githubUser: 'logflash',
  copyrightYear: 2026,
  avatar: '/avatar.png', // 256px — og:image and favicon
  avatarSmall: '/avatar-160.webp', // rendered at 40/76px in the UI
}

export const navItems: NavItem[] = [
  { id: 'home', label: msg('Home') },
  { id: 'about', label: msg('About') },
  { id: 'research', label: msg('Research') },
  { id: 'projects', label: msg('Projects') },
  { id: 'contact', label: msg('Contact') },
]

// The mobile pill nav omits Home: the top bar isn't sticky, so a back-to-top
// pill would only be tappable when already at the top.
export const mobileNavItems: NavItem[] = navItems.filter((item) => item.id !== 'home')
