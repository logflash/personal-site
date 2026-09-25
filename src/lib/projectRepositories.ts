export const PROJECT_REPOSITORIES = [
  'logflash/behavior-cloning-mechinterp',
  'logflash/neu-scene-decoding',
  'logflash/timeskip-diffuser',
  'logflash/pacman-optimal-dev',
  'pacbot-competition/pacbot-2',
  'logflash/embedded-solar-mppt',
] as const

export type ProjectStarCounts = Record<string, number>

export function githubRepositoryKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parts.length !== 2) {
      return null
    }
    return `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`.toLowerCase()
  } catch {
    return null
  }
}
