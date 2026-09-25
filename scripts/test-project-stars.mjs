import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const transpile = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
}
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

const repositoryModuleUrl = dataUrl(await transpile('../src/lib/projectRepositories.ts'))
const { PROJECT_REPOSITORIES, githubRepositoryKey } = await import(repositoryModuleUrl)

const projectMdx = await readFile(new URL('../src/content/Projects.mdx', import.meta.url), 'utf8')
const contentRepositories = [
  ...projectMdx.matchAll(/\burl="(https:\/\/github\.com\/[^\"]+)"/g),
].map(([, url]) => githubRepositoryKey(url))
assert.equal(contentRepositories.length, PROJECT_REPOSITORIES.length)
assert.deepEqual(contentRepositories.sort(), [...PROJECT_REPOSITORIES].sort())
assert.equal(githubRepositoryKey('https://github.com/LOGFLASH/example.git'), 'logflash/example')
assert.equal(githubRepositoryKey('https://example.com/logflash/example'), null)

const codec = await transpile('../src/lib/projectStarSession.ts')
const linkedCodec = codec.replace(
  /from ['"]\.\/projectRepositories['"]/,
  `from '${repositoryModuleUrl}'`,
)
assert.notEqual(linkedCodec, codec, 'the session codec must import the repository list')
const { encodeProjectStarSession, decodeProjectStarSession } = await import(dataUrl(linkedCodec))
const counts = Object.fromEntries(
  PROJECT_REPOSITORIES.map((repository, index) => [repository, index]),
)
const encoded = encodeProjectStarSession(counts)
assert.ok(encoded)
assert.deepEqual(decodeProjectStarSession(encoded), counts)
assert.equal(encodeProjectStarSession({ ...counts, [PROJECT_REPOSITORIES[0]]: -1 }), null)
assert.equal(decodeProjectStarSession('invalid cookie'), null)
assert.equal(decodeProjectStarSession(btoa(JSON.stringify({ ...counts, unexpected: 4 }))), null)

const contributionModuleUrl = dataUrl(await transpile('../src/lib/contributionSession.ts'))
const { encodeContributionSession } = await import(contributionModuleUrl)
const combinedCodec = await transpile('../src/lib/githubStatsSession.ts')
const linkedCombinedCodec = combinedCodec
  .replace(/from ['"]\.\/contributionSession['"]/, `from '${contributionModuleUrl}'`)
  .replace(/from ['"]\.\/projectStarSession['"]/, `from '${dataUrl(linkedCodec)}'`)
assert.notEqual(linkedCombinedCodec, combinedCodec)
const { encodeGitHubStatsSession, decodeGitHubStatsSession } = await import(
  dataUrl(linkedCombinedCodec)
)
const contributionData = {
  total: { lastYear: 2 },
  contributions: [{ date: '2026-09-24', count: 2, level: 1 }],
}
const combined = encodeGitHubStatsSession(encodeContributionSession(contributionData), encoded)
assert.ok(combined)
assert.deepEqual(decodeGitHubStatsSession(combined), {
  contributions: contributionData,
  projectStars: counts,
})
assert.equal(encodeGitHubStatsSession(null, null), null)
assert.deepEqual(decodeGitHubStatsSession('not-a-session'), {
  contributions: null,
  projectStars: null,
})

console.log('Project star tests passed')
