import { getCache } from '@vercel/functions'
import { createVisitCache } from './visitCache'
import { decodeContributionSession } from './contributionSession'
import { loadContributions } from './contributions'
import { decodeProjectStarSnapshot } from './projectStarSession'
import { loadProjectStars } from './projectStars'
import { profile } from '../data/site'

// Runtime Cache is shared per region on Vercel; the SDK uses memory locally.
// Include the site/user because Hobby projects share a cache namespace.
const store = getCache({ namespace: `ianhenriques.com:github:${profile.githubUser}:v1` })

export const readSharedContributions = createVisitCache({
  key: 'contributions',
  intervalMs: 60_000,
  store,
  valid: (value) => decodeContributionSession(value) !== null,
  refresh: async (previous) => {
    const result = await loadContributions(decodeContributionSession(previous ?? undefined), true)
    return result.cookie
  },
})

export const readSharedProjectStars = createVisitCache({
  key: 'project-stars',
  intervalMs: 300_000,
  store,
  valid: (value) => decodeProjectStarSnapshot(value) !== null,
  refresh: async (previous) => {
    const result = await loadProjectStars(decodeProjectStarSnapshot(previous), true)
    return JSON.stringify(result.data)
  },
})
