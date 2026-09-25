import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequest, setCookie } from '@tanstack/react-start/server'
import {
  decodeContributionSession,
  encodeContributionSession,
  shouldRefreshContributions,
} from './contributionSession'
import { CONTRIBUTION_SESSION_COOKIE, loadContributions } from './contributions'
import { decodeGitHubStatsSession, encodeGitHubStatsSession } from './githubStatsSession'
import { decodeProjectStarSession, encodeProjectStarSession } from './projectStarSession'
import { PROJECT_STARS_SESSION_COOKIE, loadProjectStars } from './projectStars'

const SESSION_COOKIE = 'github-stats-v1'

/** Keep both sets of public GitHub data in the initial SSR response. */
export const fetchGitHubStats = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const refresh = shouldRefreshContributions(request)
  const savedCookie = getCookie(SESSION_COOKIE)
  const saved = decodeGitHubStatsSession(savedCookie)
  const [contributions, projectStars] = await Promise.all([
    loadContributions(
      saved.contributions ?? decodeContributionSession(getCookie(CONTRIBUTION_SESSION_COOKIE)),
      refresh,
    ),
    loadProjectStars(
      saved.projectStars ?? decodeProjectStarSession(getCookie(PROJECT_STARS_SESSION_COOKIE)),
      refresh,
    ),
  ])

  const encoded = encodeGitHubStatsSession(
    contributions.cookie ??
      (contributions.data ? encodeContributionSession(contributions.data) : null),
    projectStars.cookie ?? encodeProjectStarSession(projectStars.data),
  )
  if (encoded && encoded !== savedCookie) {
    setCookie(SESSION_COOKIE, encoded, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
    })
  }

  return { contributions: contributions.data, projectStars: projectStars.data }
})
