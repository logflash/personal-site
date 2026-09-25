import { PROJECT_REPOSITORIES, type ProjectStarCounts } from './projectRepositories'

const MAX_COOKIE_LENGTH = 2048
const MAX_STAR_COUNT = 1_000_000_000

export function hasAllProjectStars(stars: ProjectStarCounts): boolean {
  return PROJECT_REPOSITORIES.every(
    (repository) =>
      Number.isSafeInteger(stars[repository]) &&
      stars[repository] >= 0 &&
      stars[repository] <= MAX_STAR_COUNT,
  )
}

export function encodeProjectStarSession(stars: ProjectStarCounts): string | null {
  if (!hasAllProjectStars(stars)) return null
  const ordered = Object.fromEntries(
    PROJECT_REPOSITORIES.map((repository) => [repository, stars[repository]]),
  )
  const encoded = btoa(JSON.stringify(ordered))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return encoded.length <= MAX_COOKIE_LENGTH ? encoded : null
}

export function decodeProjectStarSession(cookie: string | undefined): ProjectStarCounts | null {
  if (!cookie || cookie.length > MAX_COOKIE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cookie)) return null
  try {
    const parsed: unknown = JSON.parse(atob(cookie.replace(/-/g, '+').replace(/_/g, '/')))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const stars = parsed as ProjectStarCounts
    if (Object.keys(stars).length !== PROJECT_REPOSITORIES.length || !hasAllProjectStars(stars)) {
      return null
    }
    return Object.fromEntries(
      PROJECT_REPOSITORIES.map((repository) => [repository, stars[repository]]),
    )
  } catch {
    return null
  }
}
