import type { ContributionsResponse } from './contributions'

const COOKIE_VERSION = '1'
const MAX_DAYS = 400
const MAX_COUNT = 999_999
const MAX_TOTAL = 999_999_999
const MAX_COOKIE_LENGTH = 3800
const DAY_MS = 24 * 60 * 60 * 1000

function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const year = Number(date.slice(0, 4))
  if (year < 1970 || year > 2100) return null
  const time = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
    ? time / DAY_MS
    : null
}

/** Store public calendar data in a small session cookie so SSR survives reloads. */
export function encodeContributionSession(data: ContributionsResponse): string | null {
  const days = data.contributions
  if (
    days.length < 1 ||
    days.length > MAX_DAYS ||
    !Number.isSafeInteger(data.total.lastYear) ||
    data.total.lastYear < 0 ||
    data.total.lastYear > MAX_TOTAL
  ) {
    return null
  }

  const firstDay = dayNumber(days[0].date)
  if (firstDay === null) return null

  const entries: string[] = []
  for (const [index, day] of days.entries()) {
    if (
      dayNumber(day.date) !== firstDay + index ||
      !Number.isSafeInteger(day.count) ||
      day.count < 0 ||
      day.count > MAX_COUNT ||
      !Number.isInteger(day.level) ||
      day.level < 0 ||
      day.level > 4
    ) {
      return null
    }
    entries.push(`${day.count.toString(36)}${day.level}`)
  }

  const encoded = `${COOKIE_VERSION}~${days[0].date}~${data.total.lastYear.toString(36)}~${entries.join('.')}`
  return encoded.length <= MAX_COOKIE_LENGTH ? encoded : null
}

export function decodeContributionSession(
  cookie: string | undefined,
): ContributionsResponse | null {
  if (!cookie || cookie.length > MAX_COOKIE_LENGTH) return null
  const parts = cookie.split('~')
  if (parts.length !== 4 || parts[0] !== COOKIE_VERSION) return null
  const firstDay = dayNumber(parts[1])
  if (firstDay === null || !/^[0-9a-z]+$/.test(parts[2])) return null
  const total = Number.parseInt(parts[2], 36)
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_TOTAL) return null

  const entries = parts[3].split('.')
  if (entries.length < 1 || entries.length > MAX_DAYS) return null
  const contributions = []
  for (const [index, entry] of entries.entries()) {
    if (!/^[0-9a-z]+[0-4]$/.test(entry)) return null
    const count = Number.parseInt(entry.slice(0, -1), 36)
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_COUNT) return null
    contributions.push({
      date: new Date((firstDay + index) * DAY_MS).toISOString().slice(0, 10),
      count,
      level: Number(entry.at(-1)),
    })
  }
  return { total: { lastYear: total }, contributions }
}

/** Force reloads usually send no-cache; ordinary reloads usually send max-age=0. */
export function requestBypassesCache(request: Request): boolean {
  return (
    /(?:^|,)\s*no-cache\s*(?:,|$)/i.test(request.headers.get('cache-control') ?? '') ||
    /(?:^|,)\s*no-cache\s*(?:,|$)/i.test(request.headers.get('pragma') ?? '')
  )
}

export function shouldRefreshContributions(request: Request): boolean {
  return (
    new URL(request.url).searchParams.has('refreshContributions') || requestBypassesCache(request)
  )
}
