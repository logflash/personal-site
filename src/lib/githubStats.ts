import { createServerFn } from '@tanstack/react-start'
import { formatMessage } from '@generaltranslation/format'
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
import loadTranslations from '../loadTranslations'
import { contributionDateValue, DAILY_CONTRIBUTION_SUMMARY } from './contributionLabels'
import { SUPPORTED_LOCALES } from './localePath'
import { translationHash } from './translationHash'

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

/** Reuse SSR's localized calendar labels during hydration instead of formatting
 * every date a second time on the browser's main thread. */
export const fetchHomeGitHubStats = createServerFn({ method: 'GET' })
  .validator((locale: string) => {
    if (!SUPPORTED_LOCALES.includes(locale)) throw new Error('Unsupported locale')
    return locale
  })
  .handler(async ({ data: locale }) => {
    const [stats, translations] = await Promise.all([fetchGitHubStats(), loadTranslations(locale)])
    const translated = translations[translationHash(DAILY_CONTRIBUTION_SUMMARY)]
    const template = typeof translated === 'string' ? translated : DAILY_CONTRIBUTION_SUMMARY
    const dailySummaries = Object.fromEntries(
      (stats.contributions?.contributions ?? []).map((day) => [
        day.date,
        formatMessage(template, {
          locales: locale,
          variables: { count: day.count, date: contributionDateValue(day.date) },
        }),
      ]),
    )
    return { ...stats, dailySummaries }
  })
