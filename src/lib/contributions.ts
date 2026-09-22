import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequest, setCookie } from '@tanstack/react-start/server'
import { profile } from '../data/site'
import {
  decodeContributionSession,
  encodeContributionSession,
  shouldRefreshContributions,
} from './contributionSession'

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

const SESSION_COOKIE = 'contribution-calendar-v1'

/**
 * Fetched in the route loader so the graph is part of the SSR HTML — no
 * client-side pop-in or layout shift. A compact session cookie avoids repeated
 * upstream requests across document reloads, including on serverless hosts.
 */
export const fetchContributions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ContributionsResponse | null> => {
    const request = getRequest()
    const saved = decodeContributionSession(getCookie(SESSION_COOKIE))
    if (saved && !shouldRefreshContributions(request)) return saved

    try {
      const res = await fetch(API_URL, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ContributionsResponse
      const encoded = encodeContributionSession(data)
      if (!encoded) throw new Error('Invalid contribution calendar response')
      setCookie(SESSION_COOKIE, encoded, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(request.url).protocol === 'https:',
        path: '/',
      })
      return data
    } catch {
      // A failed forced refresh should not erase a previously rendered graph.
      return saved
    }
  },
)
