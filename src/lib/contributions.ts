import { profile } from '../data/site'

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

const OK_TTL_MS = 10 * 60 * 1000
const FAIL_TTL_MS = 60 * 1000

let cached: { data: ContributionsResponse | null; expires: number } | null = null

/**
 * Fetched in the route loader so the graph is part of the SSR HTML — no
 * client-side pop-in or layout shift. Cached per server instance; failures
 * resolve to null (the graph is decorative) and are retried after a minute.
 */
export async function fetchContributions(): Promise<ContributionsResponse | null> {
  if (cached && Date.now() < cached.expires) return cached.data
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as ContributionsResponse
    cached = { data, expires: Date.now() + OK_TTL_MS }
  } catch {
    cached = { data: null, expires: Date.now() + FAIL_TTL_MS }
  }
  return cached.data
}
