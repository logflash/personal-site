// Identity and navigation stay in TypeScript because they are shared by page
// chrome, route metadata, and server loaders. Long-form page copy lives in
// src/content/*.mdx.
export interface NavItem {
  id: string
  label: string
  to?: '/$locale/resume' | '/$locale/publications' | '/$locale/projects'
  transition?: string
}

export const profile = {
  name: 'Ian Henriques',
  handle: '@logflash',
  githubUser: 'logflash',
  copyrightYear: 2026,
  avatar: '/avatar.png', // 256px — og:image and favicon
}

const pageLinks: NavItem[] = [
  { id: 'resume', label: 'Resume', to: '/$locale/resume', transition: 'resume-title' },
  {
    id: 'publications',
    label: 'Publications',
    to: '/$locale/publications',
    transition: 'publications-title',
  },
  { id: 'projects', label: 'Projects', to: '/$locale/projects', transition: 'projects-title' },
]

export const navItems: NavItem[] = [
  { id: 'home', label: 'Home' },
  ...pageLinks,
  { id: 'contact', label: 'Contact' },
]

export const resumeNavItems: NavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'education', label: 'Education' },
  { id: 'experience', label: 'Experience' },
  { id: 'skills', label: 'Skills' },
]

export function pageNavItems(pathname: string): NavItem[] | undefined {
  const page = pathname.replace(/\/$/, '').split('/').at(-1)
  if (page === 'resume') return resumeNavItems
  const current = [...pageLinks, { id: 'not-found', label: 'Not Found' }].find(
    (item) => item.id === page,
  )
  if (current)
    return [
      { id: 'home', label: 'Home' },
      { id: current.id, label: current.label },
    ]
}

// The mobile pill nav omits Home: the top bar isn't sticky, so a back-to-top
// pill would only be tappable when already at the top.
export const mobileNavItems: NavItem[] = navItems.filter((item) => item.id !== 'home')
