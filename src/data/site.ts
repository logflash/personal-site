// Single source of truth for site content.
// User-facing copy is registered with gt-react's msg() (safe at module
// scope on the server); components decode it at render time via useMessages().

import { msg } from 'gt-react'

export interface NavItem {
  id: string
  label: string
}

export interface QuickLink {
  label: string
  href: string
  external?: boolean
}

export interface TimelineEntry {
  when: string
  what: string
}

export interface Paper {
  name: string
  venue: string
  desc: string
  url: string
}

export interface LangChip {
  lang: string
  color: string
}

export interface Repo {
  name: string
  desc: string
  url: string
  repoPath: string
  langChips: LangChip[]
}

export interface ContactRow {
  label: string
  text: string
  /** Omitted for the email row: plain text, no mailto (scraper-unfriendly). */
  href?: string
  external?: boolean
}

export const profile = {
  name: 'Ian Henriques',
  handle: '@logflash',
  githubUser: 'logflash',
  copyrightYear: 2026,
  avatar: '/avatar.png',
  intro: msg(
    "I'm Ian, a Ph.D. student at MIT working on training and applying signal-based foundation models for medical applications. Before that: a B.S.E. and M.Eng in ECE at Princeton, research in disease detection and robot learning, three summers at NVIDIA, and a founding engineer role at General Translation.",
  ),
  about: [
    msg(
      'As of Fall 2026, I am a Ph.D. student in EECS at MIT (advised by Dina Katabi), working on building foundation models that combine physiological signals and electronic medical records to enable non-invasive reasoning about patient health and wellness.',
    ),
    msg(
      'I studied ECE at Princeton — graduating first in my class of 1,305 students — where my research spanned wearable disease detection, energy-based models, and robot learning.',
    ),
  ],
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

export const quickLinks: QuickLink[] = [
  { label: msg('Resume'), href: __RESUME_HREF__, external: true },
  {
    label: 'Google Scholar',
    href: 'https://scholar.google.com/citations?user=PfM704AAAAAJ',
    external: true,
  },
  { label: 'GitHub', href: 'https://github.com/logflash', external: true },
]

export const timeline: TimelineEntry[] = [
  { when: '2026 —', what: msg('Ph.D. EECS, MIT — Katabi Lab') },
  { when: '2026', what: msg('General Translation — Infra-Product Team') },
  { when: '2025 — 26', what: msg('M.Eng. ECE, Princeton — Jha Lab · Silver Lab') },
  { when: '2025', what: msg('NeuTigers, Inc. — Data and AI Consultancy') },
  { when: '2021 — 25', what: msg('B.S.E. ECE, Princeton — Class Rank 1 of 1.3k') },
  { when: msg('summers'), what: msg('NVIDIA × 3 — Performance and Power Teams') },
]

export const papers: Paper[] = [
  {
    name: 'SweetDeep: Predicting Type 2 Diabetes with Smartwatches',
    venue: 'arXiv:2512.03471',
    desc: msg(
      'A compact neural network (under 3,000 parameters) that detects type 2 diabetes from free-living smartwatch sensor recordings and demographic data, reaching ~80% patient-level accuracy.',
    ),
    url: 'https://arxiv.org/pdf/2512.03471',
  },
]

const LANG_COLORS: Record<string, string> = {
  Python: '#3572A5',
  Go: '#00ADD8',
  Svelte: '#ff3e00',
  C: '#555555',
  Jupyter: '#DA5B0B',
}

interface RepoSource {
  name: string
  desc: string
  lang: string
  color: string
  url: string
}

const REPO_SOURCES: RepoSource[] = [
  {
    name: msg('Behavior Cloning Interpretability'),
    desc: msg(
      'Trained and probed end-to-end ViT policies for robot navigation, to understand which transformer blocks were responsible for predicting and determining actions.',
    ),
    lang: 'Python',
    color: '#3572A5',
    url: 'https://github.com/logflash/behavior-cloning-mechinterp',
  },
  {
    name: msg('fMRI Scene Decoding'),
    desc: msg(
      'Used a dataset of narrative stimuli and BOLD responses to determine brain regions that are selective to purely auditory descriptions of specific scenes.',
    ),
    lang: 'Jupyter · Python',
    color: '#DA5B0B',
    url: 'https://github.com/logflash/neu-scene-decoding',
  },
  {
    name: msg('Timeskip Diffusion Planning'),
    desc: msg(
      'Added "timeskip" pseudo-actions to maze-solving diffusion planners, allowing for more flexible, reward-guidable timescales for different regions of a differentially flat plan.',
    ),
    lang: 'Python',
    color: '#3572A5',
    url: 'https://github.com/logflash/timeskip-diffuser',
  },
  {
    name: msg('Safety Value Iteration for Pacman'),
    desc: msg(
      'Solved Pacman as a discrete pursuit-evasion game, then used the learned optimal value functions to explore safety guarantees and equilibria for the Pacman and ghost teams.',
    ),
    lang: 'C++ [OpenMP]',
    color: '#f34b7d',
    url: 'https://github.com/logflash/pacman-optimal-dev',
  },
  {
    name: msg('Pacman Competition Infrastructure'),
    desc: msg(
      'Created and maintained the game server, computer vision tracker, web console, and client infrastructure for the Pacbot Robotics Competition.',
    ),
    lang: 'Go · Svelte · Python',
    color: '#00ADD8',
    url: 'https://github.com/logflash/Pacbot-2',
  },
  {
    name: msg('Embedded Solar Charging Controller'),
    desc: msg(
      'Built a closed-loop, variable solar charger using a power sensor and a buck-converter, then wrote firmware to experiment with different power maximization algorithms.',
    ),
    lang: 'C++ [Arduino]',
    color: '#f34b7d',
    url: 'https://github.com/logflash/Embedded-Solar-MPPT',
  },
]

export const repos: Repo[] = REPO_SOURCES.map(({ lang, color, ...rest }) => ({
  ...rest,
  repoPath: rest.url.replace('https://', ''),
  langChips: lang.split(' · ').map((l) => ({ lang: l, color: LANG_COLORS[l] ?? color })),
}))

export const contactRows: ContactRow[] = [
  { label: msg('email'), text: 'ian [at] ianlh [dot] com' },
  {
    label: 'linkedin',
    text: 'linkedin.com/in/ian-henriques',
    href: 'https://www.linkedin.com/in/ian-henriques/',
    external: true,
  },
  {
    label: 'github',
    text: 'github.com/logflash',
    href: 'https://github.com/logflash',
    external: true,
  },
  { label: 'twitter', text: '@logflash_', href: 'https://x.com/logflash_', external: true },
]
