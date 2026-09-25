import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/contributionSession.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const {
  encodeContributionSession,
  decodeContributionSession,
  requestBypassesCache,
  shouldRefreshContributions,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const days = Array.from({ length: 367 }, (_, index) => ({
  date: new Date(Date.UTC(2025, 8, 21 + index)).toISOString().slice(0, 10),
  count: index % 24,
  level: index % 5,
}))
const data = { total: { lastYear: 492 }, contributions: days }
const encoded = encodeContributionSession(data)
assert.ok(encoded, 'a full calendar must fit in a browser cookie')
assert.deepEqual(decodeContributionSession(encoded), data)

assert.equal(encodeContributionSession({ ...data, contributions: [] }), null)
assert.equal(
  encodeContributionSession({ ...data, contributions: [days[0], days[2]] }),
  null,
  'missing dates must not silently shift later entries',
)
assert.equal(decodeContributionSession('1~2026-02-30~0~00'), null)
assert.equal(decodeContributionSession('1~9999-12-31~0~00'), null)
assert.equal(decodeContributionSession('1~2026-09-21~0~zz9'), null)
assert.equal(decodeContributionSession(`${encoded}.garbage`), null)

const request = (headers = {}, suffix = '') =>
  new Request(`https://example.com/en${suffix}`, { headers })
assert.equal(shouldRefreshContributions(request()), false)
assert.equal(shouldRefreshContributions(request({ 'cache-control': 'max-age=0' })), false)
assert.equal(shouldRefreshContributions(request({ 'cache-control': 'no-cache' })), true)
assert.equal(shouldRefreshContributions(request({ pragma: 'no-cache' })), true)
assert.equal(shouldRefreshContributions(request({}, '?refreshContributions=1')), true)
assert.equal(requestBypassesCache(request({ 'cache-control': 'max-age=0' })), false)
assert.equal(requestBypassesCache(request({ 'cache-control': 'no-cache' })), true)
assert.equal(requestBypassesCache(request({ pragma: 'no-cache' })), true)
assert.equal(requestBypassesCache(request({}, '?refreshContributions=1')), false)

console.log('Contribution session tests passed')
