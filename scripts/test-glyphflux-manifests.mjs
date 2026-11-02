import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import ts from 'typescript'
import { splitGlyphfluxManifests } from './split-glyphflux-manifests.js'

async function importTypeScript(path) {
  const source = await readFile(path, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

const indexPath = 'src/generated/glyphfluxManifests.ts'
const before = await readFile(indexPath, 'utf8')
await splitGlyphfluxManifests()
assert.equal(await readFile(indexPath, 'utf8'), before, 'rebuilding must preserve URLs and order')
const {
  glyphfluxManifestByKey: byKey,
  glyphfluxManifestUrlsByLocale: byLocale,
  glyphfluxManifestUrlsByText: byText,
} = await importTypeScript(indexPath)
const { createPreparedGlyphfluxLoader } = await importTypeScript('src/lib/preparedGlyphflux.ts')
const bodies = new Map()
for (const [locale, urls] of Object.entries(byLocale)) {
  const original = JSON.parse(await readFile(`tmp/glyphflux/${locale}.json`, 'utf8'))
  const reconstructed = { version: 2, outlines: {}, sdfMorphs: {} }
  for (const url of urls) {
    const body = await readFile(`public${url}`, 'utf8')
    assert.ok(Buffer.byteLength(body) < 3_000_000, 'keep each response below the size budget')
    assert.equal(url, `/glyphflux/${createHash('sha256').update(body).digest('hex')}.json`)
    bodies.set(url, body)
    const manifest = JSON.parse(body)
    const keys = [
      ...new Set([...Object.keys(manifest.outlines), ...Object.keys(manifest.sdfMorphs)]),
    ]
    assert.equal(keys.length, 1, 'one text/font pair per response')
    assert.equal(byKey[keys[0]], url)
    assert.ok(byText[JSON.parse(keys[0])[0]].includes(url))
    Object.assign(reconstructed.outlines, manifest.outlines)
    Object.assign(reconstructed.sdfMorphs, manifest.sdfMorphs)
  }
  assert.deepEqual(reconstructed, original, `${locale}: preserve every outline and SDF value`)
  console.log(`${locale}: ${urls.length} chunks reconstruct the original manifest exactly.`)
}
assert.deepEqual(
  (await readdir('public/glyphflux')).filter((file) => file.endsWith('.json')).sort(),
  [...bodies.keys()].map((url) => url.split('/').at(-1)).sort(),
  'do not ship stale chunks or the old large locale bundles',
)

const calls = []
const loader = createPreparedGlyphfluxLoader(byKey, byText, async (url) => {
  calls.push(url)
  return new Response(bodies.get(url))
})
const key = Object.keys(byKey)[0]
const text = JSON.parse(key)[0]
const forward = { key, reverseKey: 'missing-reverse-key' }
const reverse = { key: forward.reverseKey, reverseKey: key }
const [a, b] = await Promise.all([loader(text, forward), loader(text, reverse)])
assert.deepEqual(a, b, 'reverse morphs reuse the forward pair')
assert.equal(calls.length, 1, 'concurrent requests share one fetch and parse')
await loader(text, forward)
assert.equal(calls.length, 1, 'subsequent requests use the parsed cache')
const all = await loader(text)
assert.equal(calls.length, byText[text].length, 'legacy calls load only the requested text')
assert.ok(Object.keys(all.sdfMorphs).every((pair) => JSON.parse(pair)[0] === text))
assert.equal(loader('unknown text', forward), undefined)
assert.equal(loader(text, { key: 'unknown', reverseKey: 'unknown-reverse' }), undefined)

for (const failure of ['http', 'network', 'json']) {
  let attempts = 0
  const retry = createPreparedGlyphfluxLoader(byKey, byText, async (url) => {
    if (++attempts === 1) {
      if (failure === 'network') throw new Error('Disconnected')
      return failure === 'http' ? new Response(null, { status: 503 }) : new Response('invalid')
    }
    return new Response(bodies.get(url))
  })
  await assert.rejects(retry(text, forward))
  assert.deepEqual(await retry(text, forward), a, `${failure}: retry a failed preparation`)
  assert.equal(attempts, 2)
}
console.log('Manifest integrity, deterministic URLs, reverse lookup, caching and retries passed.')

// Opt in against a running preview to verify eager preload reuse through
// forward/reverse navigation on both responsive layouts.
if (process.env.EXPERIMENT_BASE_URL) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const locale of Object.keys(byLocale)) {
      for (const width of [412, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } })
        // Vercel injects this endpoint in production; the local server does not.
        await context.route('**/_vercel/insights/**', (route) =>
          route.fulfill({ contentType: 'application/javascript', body: '' }),
        )
        const page = await context.newPage()
        const fetched = []
        const errors = []
        page.on('request', (request) => {
          if (new URL(request.url()).pathname.startsWith('/glyphflux/')) fetched.push(request.url())
        })
        page.on('requestfailed', (request) => errors.push(request.url()))
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(`${process.env.EXPERIMENT_BASE_URL}/${locale}`, {
          waitUntil: 'networkidle',
        })
        const links = await page
          .locator('link[rel="preload"][as="fetch"]')
          .evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute('href'))
              .filter((url) => url.startsWith('/glyphflux/')),
          )
        assert.deepEqual([...links].sort(), [...byLocale[locale]].sort())
        for (const route of ['resume', 'publications', 'projects']) {
          await page.locator(`.quick-links [data-font-morph="${route}-title"]`).click()
          await page.waitForURL(`${process.env.EXPERIMENT_BASE_URL}/${locale}/${route}`)
          await page.waitForFunction(
            () => !document.documentElement.hasAttribute('data-font-morph-active'),
          )
          await page
            .locator(width < 600 ? '.identity-text-link' : '.side-nav .resume-home-nav-link')
            .click()
          await page.waitForURL(`${process.env.EXPERIMENT_BASE_URL}/${locale}`)
          await page.waitForFunction(
            () => !document.documentElement.hasAttribute('data-font-morph-active'),
          )
        }
        const resources = await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .filter((entry) => new URL(entry.name).pathname.startsWith('/glyphflux/'))
            .map((entry) => ({ url: new URL(entry.name).pathname, bytes: entry.transferSize })),
        )
        assert.equal(fetched.length, byLocale[locale].length, 'fetch reuses the eager preload')
        assert.equal(new Set(fetched).size, fetched.length, 'no duplicate network requests')
        assert.deepEqual(errors, [])
        console.log(
          `${locale} ${width}px: ${fetched.length} eager requests, no duplicates or failures; ${resources.reduce((sum, entry) => sum + entry.bytes, 0)} transferred bytes.`,
        )
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
