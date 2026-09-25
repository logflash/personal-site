import { decodeContributionSession } from './contributionSession'
import type { ContributionsResponse } from './contributions'
import type { ProjectStarCounts } from './projectRepositories'
import { decodeProjectStarSession } from './projectStarSession'

const VERSION = '1'
const MAX_COOKIE_LENGTH = 3800

export function encodeGitHubStatsSession(
  contributionCookie: string | null,
  projectStarsCookie: string | null,
): string | null {
  if (!contributionCookie && !projectStarsCookie) return null
  const encoded = `${VERSION}:${contributionCookie ?? ''}:${projectStarsCookie ?? ''}`
  return encoded.length <= MAX_COOKIE_LENGTH ? encoded : null
}

export function decodeGitHubStatsSession(cookie: string | undefined): {
  contributions: ContributionsResponse | null
  projectStars: ProjectStarCounts | null
} {
  if (!cookie || cookie.length > MAX_COOKIE_LENGTH) {
    return { contributions: null, projectStars: null }
  }
  const parts = cookie.split(':')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { contributions: null, projectStars: null }
  }
  return {
    contributions: decodeContributionSession(parts[1]),
    projectStars: decodeProjectStarSession(parts[2]),
  }
}
