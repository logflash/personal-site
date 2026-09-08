import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import opentype from 'opentype.js'
import { getBrowser, newPage } from './browser.mjs'

function glyphPath({ serif }) {
  const path = new opentype.Path()
  if (serif) {
    path.moveTo(30, 0)
    path.lineTo(570, 0)
    path.lineTo(540, 75)
    path.lineTo(525, 625)
    path.lineTo(570, 700)
    path.lineTo(30, 700)
    path.lineTo(75, 625)
    path.lineTo(60, 75)
    path.close()
    path.moveTo(170, 205)
    path.lineTo(170, 515)
    path.lineTo(430, 515)
    path.lineTo(430, 205)
    path.close()
  } else {
    path.moveTo(50, 0)
    path.lineTo(550, 0)
    path.lineTo(550, 700)
    path.lineTo(50, 700)
    path.close()
    path.moveTo(180, 225)
    path.lineTo(180, 495)
    path.lineTo(420, 495)
    path.lineTo(420, 225)
    path.close()
  }
  return path
}

function fixtureFont(familyName, serif) {
  const notdef = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 650,
    path: glyphPath({ serif: false }),
  })
  const e = new opentype.Glyph({
    name: 'e',
    unicode: 101,
    advanceWidth: serif ? 690 : 640,
    path: glyphPath({ serif }),
  })
  const font = new opentype.Font({
    familyName,
    styleName: 'Regular',
    unitsPerEm: 1_000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, e],
  })
  return Buffer.from(font.toArrayBuffer())
}

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/styles.css">
    <style>
      @font-face { font-family: "Fixture Sans"; src: url("/sans.otf"); }
      @font-face { font-family: "Fixture Serif"; src: url("/serif.otf"); }
      :root { --font-morph-duration: 640ms; }
      body { margin: 0; min-height: 100vh; background: #fff; }
      #fixture { position: relative; height: 600px; }
      .endpoint { position: absolute; display: inline-block; white-space: pre; line-height: 1; }
      .sans { left: 32px; top: 48px; color: rgb(72 35 128); font: 400 52px/1 "Fixture Sans"; }
      .serif { left: 310px; top: 230px; color: rgb(15 70 105); font: 400 104px/1 "Fixture Serif"; }
      .serif.moved { left: 55vw; top: 28vh; font-size: 84px; }
    </style>
  </head>
  <body>
    <main id="fixture"><span class="endpoint sans" data-font-morph="sample">ee</span></main>
    <script type="module" src="/bundle.js"></script>
  </body>
</html>`

const [{ text: bundle }] = (
  await build({
    entryPoints: [fileURLToPath(new URL('./fixture.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  })
).outputFiles

const assets = new Map([
  ['/', ['text/html; charset=utf-8', Buffer.from(html)]],
  ['/bundle.js', ['text/javascript; charset=utf-8', Buffer.from(bundle)]],
  ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]],
  [
    '/styles.css',
    ['text/css; charset=utf-8', Buffer.from(await readFile(new URL('../styles.css', import.meta.url)))],
  ],
  ['/sans.otf', ['font/otf', fixtureFont('Fixture Sans', false)]],
  ['/serif.otf', ['font/otf', fixtureFont('Fixture Serif', true)]],
])

const server = createServer((request, response) => {
  const asset = assets.get(request.url ?? '/')
  if (!asset) {
    response.writeHead(404).end('Not found')
    return
  }
  response.writeHead(200, { 'Content-Type': asset[0], 'Cache-Control': 'no-store' })
  response.end(asset[1])
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')

const errors = []
let closeBrowser
try {
  const { browser, close } = await getBrowser()
  closeBrowser = close
  const page = await newPage(browser)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)

  const preparation = await page.evaluate(async () => {
    const started = performance.now()
    await window.fontMorphFixture.prepare()
    return performance.now() - started
  })
  assert(preparation >= 0, 'preparation should complete')
  assert.equal(await page.evaluate(() => window.fontMorphFixture.start()), true)

  await page.waitForSelector('.font-morph-layer path', { state: 'attached' })
  const samples = []
  for (let index = 0; index < 8; index += 1) {
    if (index === 3) {
      await page.setViewportSize({ width: 760, height: 620 })
      await page.evaluate(() => window.fontMorphFixture.moveDestination())
    }
    samples.push(
      await page.evaluate(() => {
        const layer = document.querySelector('.font-morph-layer')
        const endpoint = document.querySelector('[data-font-morph="sample"]')
        return {
          paths: [...(layer?.querySelectorAll('path') ?? [])].map((path) => path.getAttribute('d')),
          fills: [...(layer?.querySelectorAll('path') ?? [])].map((path) => path.getAttribute('fill')),
          transform: layer?.style.transform,
          width: layer?.style.width,
          endpoint: endpoint?.getBoundingClientRect().toJSON(),
          active: document.documentElement.dataset.fontMorphActive,
        }
      }),
    )
    await page.waitForTimeout(65)
  }

  const contourCounts = new Set(samples.map((sample) => sample.paths.length))
  assert.deepEqual([...contourCounts], [4], 'each glyph boundary and hole should remain separate')
  assert(
    samples.every(
      (sample) =>
        sample.fills.filter((fill) => fill === 'white').length === 2 &&
        sample.fills.filter((fill) => fill === 'black').length === 2,
    ),
    'both glyphs should retain one outer boundary and one hole',
  )
  assert(new Set(samples.map((sample) => sample.paths.join('|'))).size >= 5, 'outlines should interpolate across frames')
  assert(new Set(samples.map((sample) => `${sample.transform}|${sample.width}`)).size >= 5, 'the shared box should interpolate and track layout')

  await page.waitForFunction(() => !document.querySelector('.font-morph-layer'), null, {
    timeout: 3_000,
  })
  const settled = await page.evaluate(() => {
    const endpoint = document.querySelector('[data-font-morph="sample"]')
    return {
      className: endpoint?.className,
      active: document.documentElement.hasAttribute('data-font-morph-active'),
      fallback: document.documentElement.hasAttribute('data-font-morph-fallback'),
      events: window.fontMorphFixture.events.length,
    }
  })
  assert.match(settled.className ?? '', /serif/)
  assert.equal(settled.active, false)
  assert.equal(settled.fallback, false)
  assert.equal(settled.events, 1, 'a completed morph should emit one semantic event')

  assert.equal(await page.evaluate(() => window.fontMorphFixture.reverse()), true)
  await page.waitForSelector('.font-morph-layer path', { state: 'attached' })
  await page.waitForFunction(() => !document.querySelector('.font-morph-layer'), null, {
    timeout: 3_000,
  })
  assert.equal(
    await page.evaluate(() => document.querySelector('[data-font-morph="sample"]')?.classList.contains('sans')),
    true,
    'the same routine should morph in both font directions',
  )

  await page.evaluate(async () => {
    window.fontMorphFixture.show('serif')
    await window.fontMorphFixture.prepareReplay()
  })
  const replayPathAt = (time) =>
    page.evaluate((replayTime) => {
      window.fontMorphFixture.replayAt(replayTime)
      return [...document.querySelectorAll('.font-morph-director-layer path')].map((path) =>
        path.getAttribute('d'),
      )
    }, time)
  const early = await replayPathAt(120)
  const middle = await replayPathAt(320)
  const late = await replayPathAt(520)
  assert.equal(early.length, 4)
  assert.notDeepEqual(early, middle)
  assert.notDeepEqual(middle, late)
  await replayPathAt(580)
  assert.deepEqual(
    await replayPathAt(120),
    early,
    'rewinding should reconstruct outlines solely from replay time',
  )
  await page.evaluate(() => window.fontMorphFixture.stopReplay())
  assert.equal(await page.locator('.font-morph-director-layer').count(), 0)
  assert.deepEqual(errors, [])

  console.log(`font-morph browser checks passed (preparation ${preparation.toFixed(1)}ms)`)
} finally {
  await closeBrowser?.()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
