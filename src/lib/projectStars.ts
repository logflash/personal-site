import { PROJECT_REPOSITORIES, type ProjectStarCounts } from './projectRepositories'
import { encodeProjectStarSession } from './projectStarSession'

export const PROJECT_STARS_SESSION_COOKIE = 'project-stars-v1'
const PAGE_SIZE = 100

interface GitHubRepository {
  full_name?: unknown
  stargazers_count?: unknown
}

async function fetchOwnerStars(
  owner: string,
  repositories: readonly string[],
): Promise<ProjectStarCounts> {
  const remaining = new Set(repositories)
  const stars: ProjectStarCounts = {}
  const signal = AbortSignal.timeout(3000)

  for (let page = 1; remaining.size > 0 && page <= 10; page += 1) {
    const url = new URL(`https://api.github.com/users/${encodeURIComponent(owner)}/repos`)
    url.searchParams.set('per_page', String(PAGE_SIZE))
    url.searchParams.set('type', 'owner')
    url.searchParams.set('page', String(page))
    const response = await fetch(url, {
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ianhenriques.com',
      },
    })
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`)
    const rows: unknown = await response.json()
    if (!Array.isArray(rows)) throw new Error('Invalid GitHub repository response')

    for (const row of rows as GitHubRepository[]) {
      if (typeof row.full_name !== 'string') continue
      const repository = row.full_name.toLowerCase()
      if (
        remaining.has(repository) &&
        Number.isSafeInteger(row.stargazers_count) &&
        (row.stargazers_count as number) >= 0
      ) {
        stars[repository] = row.stargazers_count as number
        remaining.delete(repository)
      }
    }
    if (rows.length < PAGE_SIZE) break
  }

  return stars
}

export async function loadProjectStars(
  saved: ProjectStarCounts | null,
  refresh: boolean,
): Promise<{ data: ProjectStarCounts; cookie: string | null }> {
  if (saved && !refresh) return { data: saved, cookie: null }

  const byOwner = new Map<string, string[]>()
  for (const repository of PROJECT_REPOSITORIES) {
    const owner = repository.split('/')[0]
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), repository])
  }

  const results = await Promise.all(
    [...byOwner].map(async ([owner, repositories]) => {
      try {
        return await fetchOwnerStars(owner, repositories)
      } catch {
        return {}
      }
    }),
  )
  const data = Object.assign({}, saved ?? {}, ...results) as ProjectStarCounts
  return { data, cookie: encodeProjectStarSession(data) }
}
