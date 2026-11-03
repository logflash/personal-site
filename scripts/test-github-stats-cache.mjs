import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const transpile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const { createVisitCache } = await import(moduleUrl(await transpile('../src/lib/visitCache.ts')))

let time = 1_000_000
let reads = 0
const records = new Map()
const store = {
  async get(key) {
    reads++
    return structuredClone(records.get(key) ?? null)
  },
  async set(key, value, { ttl }) {
    assert.equal(ttl, 604800, 'retain stale data longer than the check interval')
    records.set(key, structuredClone(value))
  },
}
const counts = { contributions: 0, stars: 0 }
const make = (key, intervalMs, overrides = {}) =>
  createVisitCache({
    key,
    intervalMs,
    store,
    now: () => time,
    valid: (value) => value.startsWith('valid:'),
    refresh: async () => `valid:${++counts[key]}`,
    ...overrides,
  })
const contributions = make('contributions', 60_000)
const stars = make('stars', 300_000)
assert.deepEqual(counts, { contributions: 0, stars: 0 }, 'construction does no fetching')
assert.deepEqual(await Promise.all([contributions(), stars()]), ['valid:1', 'valid:1'])
const initialReads = reads
time += 59_999
assert.deepEqual(await Promise.all([contributions(), stars()]), ['valid:1', 'valid:1'])
assert.equal(reads, initialReads, 'warm requests reuse the interval without cache I/O')
time++
assert.deepEqual(await Promise.all([contributions(), stars()]), ['valid:2', 'valid:1'])
time += 240_000
assert.deepEqual(counts, { contributions: 2, stars: 1 }, 'elapsed time alone does nothing')
assert.deepEqual(await Promise.all([contributions(), stars()]), ['valid:3', 'valid:2'])
assert.equal(await make('stars', 300_000)(), 'valid:2', 'new instance uses the shared cache')
assert.equal(counts.stars, 2)

// Every simultaneous visitor waits for the fresh value before SSR can finish.
time += 60_000
let finish
let began
const started = new Promise((resolve) => {
  began = resolve
})
const gate = new Promise((resolve) => {
  finish = resolve
})
let fetched = 0
const gated = make('contributions', 60_000, {
  refresh: async (previous) => {
    fetched++
    assert.equal(previous, 'valid:3')
    began()
    await gate
    return 'valid:4'
  },
})
let rendered = false
const first = gated('valid:cookie').then((value) => {
  rendered = true
  return value
})
await started
const second = gated()
await Promise.resolve()
assert.equal(rendered, false, 'stale values must not paint before the eligible refresh')
assert.equal(fetched, 1)
finish()
assert.deepEqual(await Promise.all([first, second]), ['valid:4', 'valid:4'])

// Failed upstream requests retain the last good value and still count as checks.
time += 60_000
let failures = 0
const failing = make('contributions', 60_000, {
  refresh: async () => {
    failures++
    throw new Error('upstream offline')
  },
})
assert.equal(await failing(), 'valid:4')
assert.equal(await failing(), 'valid:4')
assert.equal(await make('contributions', 60_000)(), 'valid:4')
assert.equal(failures, 1)

let previousSeen
const cookieOnly = make('empty', 60_000, {
  refresh: async (previous) => {
    previousSeen = previous
    return null
  },
})
assert.equal(await cookieOnly('valid:untrusted-cookie'), 'valid:untrusted-cookie')
assert.equal(previousSeen, null, 'cookies never seed upstream or shared data')
assert.equal(records.get('empty').value, null)
assert.equal(await cookieOnly(), null, 'one visitor cannot alter another visitor’s fallback')

for (const value of [
  { checkedAt: time, value: 'corrupt' },
  { checkedAt: time + 1000, value: 'valid:future' },
  { checkedAt: 'invalid', value: 'valid:bad-date' },
]) {
  records.set('invalid', value)
  assert.equal(
    await make('invalid', 60_000, { refresh: async () => 'valid:recovered' })(),
    'valid:recovered',
  )
}
for (const brokenMethod of ['get', 'set']) {
  let calls = 0
  const broken = make(`broken-${brokenMethod}`, 60_000, {
    store: {
      ...store,
      [brokenMethod]: async () => {
        throw new Error('cache offline')
      },
    },
    refresh: async () => {
      calls++
      return null
    },
  })
  assert.equal(await broken('valid:fallback'), 'valid:fallback')
  assert.equal(await broken('valid:fallback'), 'valid:fallback')
  assert.equal(calls, brokenMethod === 'get' ? 0 : 1)
}

// Verify the real star loader keeps failed owners' counts while updating others.
const reposUrl = moduleUrl(await transpile('../src/lib/projectRepositories.ts'))
const codecUrl = moduleUrl(
  (await transpile('../src/lib/projectStarSession.ts')).replace(
    /from ['"]\.\/projectRepositories['"]/,
    `from '${reposUrl}'`,
  ),
)
const loaderUrl = moduleUrl(
  (await transpile('../src/lib/projectStars.ts'))
    .replace(/from ['"]\.\/projectRepositories['"]/, `from '${reposUrl}'`)
    .replace(/from ['"]\.\/projectStarSession['"]/, `from '${codecUrl}'`),
)
const { loadProjectStars } = await import(loaderUrl)
const { decodeProjectStarSnapshot } = await import(codecUrl)
assert.deepEqual(decodeProjectStarSnapshot('{"logflash/glyphflux":42}'), {
  'logflash/glyphflux': 42,
})
for (const invalid of [
  '{}',
  '[]',
  '{"unknown/repo":4}',
  '{"logflash/glyphflux":-1}',
  '{"logflash/glyphflux":"42"}',
]) {
  assert.equal(decodeProjectStarSnapshot(invalid), null)
}
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (url) =>
    String(url).includes('/users/logflash/')
      ? Response.json([{ full_name: 'logflash/glyphflux', stargazers_count: 42 }])
      : new Response(null, { status: 403 })
  const previous = { 'logflash/glyphflux': 40, 'pacbot-competition/pacbot-2': 5 }
  assert.deepEqual((await loadProjectStars(previous, true)).data, {
    'logflash/glyphflux': 42,
    'pacbot-competition/pacbot-2': 5,
  })
  globalThis.fetch = async () => {
    throw new Error('offline')
  }
  assert.deepEqual(await loadProjectStars(previous, true), { data: previous, cookie: null })
} finally {
  globalThis.fetch = originalFetch
}

console.log(
  'GitHub cache tests passed: visit-only 60s/300s refresh, SSR waiting, shared reuse, concurrency, failures, cookie isolation, partial star updates',
)

// Optional integration against the real production SSR handler, with controlled
// upstream responses and a fake clock. No network or wall-clock waiting needed.
if (process.argv.includes('--ssr')) {
  const { PROJECT_REPOSITORIES } = await import(reposUrl)
  const { default: server } = await import('../dist/server/server.js')
  const realNow = Date.now
  let clock = realNow()
  let contributionCount = 11
  let starCount = 71
  const requests = { contributions: 0, owners: 0 }
  Date.now = () => clock
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === 'github-contributions-api.jogruber.de') {
      requests.contributions++
      return Response.json({
        total: { lastYear: contributionCount },
        contributions: [{ date: '2026-11-01', count: contributionCount, level: 2 }],
      })
    }
    if (url.hostname === 'api.github.com') {
      requests.owners++
      const owner = url.pathname.split('/')[2]
      return Response.json(
        PROJECT_REPOSITORIES.filter((repo) => repo.startsWith(`${owner}/`)).map((full_name) => ({
          full_name,
          stargazers_count: starCount,
        })),
      )
    }
    throw new Error(`Unexpected upstream request: ${url.origin}`)
  }
  const visit = async (path, headers = {}) => {
    const response = await server.fetch(new Request(`http://localhost${path}`, { headers }))
    assert.equal(response.status, 200)
    return response.text()
  }
  const checkGraph = (html, count) =>
    assert.ok(
      html.includes(`title="${count} contributions · 2026-11-01"`),
      'fresh count is already in the SSR graph markup',
    )
  const checkStars = (html, count) =>
    assert.match(
      html,
      new RegExp(`class="project-stars">[\\s\\S]*?<span aria-hidden="true">${count}</span>`),
      'fresh stars are already in SSR markup',
    )
  try {
    checkGraph(await visit('/en'), 11)
    checkStars(await visit('/en/projects'), 71)
    assert.deepEqual(requests, { contributions: 1, owners: 2 })
    contributionCount = 12
    starCount = 72
    clock += 59_999
    checkGraph(await visit('/en?refreshContributions', { 'cache-control': 'no-cache' }), 11)
    assert.deepEqual(
      requests,
      { contributions: 1, owners: 2 },
      'hard reload cannot bypass shared intervals',
    )
    clock++
    checkGraph(await visit('/en'), 12)
    checkStars(await visit('/en/projects'), 71)
    assert.deepEqual(requests, { contributions: 2, owners: 2 })
    clock += 240_000
    assert.deepEqual(requests, { contributions: 2, owners: 2 }, 'idle time does not fetch')
    checkStars(await visit('/en/projects'), 72)
    checkGraph(await visit('/en'), 12)
    assert.deepEqual(requests, { contributions: 3, owners: 4 })
    for (const locale of ['es', 'ja']) {
      assert.ok((await visit(`/${locale}`)).includes('data-contribution-date="2026-11-01"'))
      checkStars(await visit(`/${locale}/projects`), 72)
    }
    assert.deepEqual(
      requests,
      { contributions: 3, owners: 4 },
      'locale changes share the same data cache',
    )
    console.log(
      'Production SSR passed: the triggering visit renders fresh graph/stars, subsequent visitors reuse them, all locales share the cache',
    )
  } finally {
    Date.now = realNow
    globalThis.fetch = originalFetch
  }
}
