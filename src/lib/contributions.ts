import { profile } from '../data/site'
import { encodeContributionSession } from './contributionSession'

export interface ContributionDay {
  date: string
  count: number
  level: number
}

export interface ContributionsResponse {
  total: { lastYear: number }
  contributions: ContributionDay[]
}

// GitHub's own calendar endpoint is CORS-blocked in browsers; this public
// mirror (the one react-github-calendar uses) serves the same data as JSON.
const API_URL = `https://github-contributions-api.jogruber.de/v4/${profile.githubUser}?y=last`

export const CONTRIBUTION_SESSION_COOKIE = 'contribution-calendar-v1'

/**
 * Fetch the chart while other GitHub metadata is fetched in parallel. The
 * caller writes the combined session cookie after both requests finish.
 */
export async function loadContributions(
  saved: ContributionsResponse | null,
  refresh: boolean,
): Promise<{ data: ContributionsResponse | null; cookie: string | null }> {
  if (saved && !refresh) return { data: saved, cookie: null }

  try {
    const res = await fetch(API_URL, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as ContributionsResponse
    const cookie = encodeContributionSession(data)
    if (!cookie) throw new Error('Invalid contribution calendar response')
    return { data, cookie }
  } catch {
    // A failed forced refresh should not erase a previously rendered graph.
    return { data: saved, cookie: null }
  }
}
