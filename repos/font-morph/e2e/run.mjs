import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import opentype from 'opentype.js'
import { compileFontMorphManifest, fontMorphPreparedKey } from '../dist/index.mjs'
import {
  compileSdfGlyphPairs,
  parseFontMorphFont,
  shapeFontMorphInstantiatedRun,
} from '../dist/compiler/index.mjs'
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
      :root {
        /* Keep the live test open long enough for resize sampling on slow CI. */
        --font-morph-duration: 1600ms;
        --font-morph-sans-weight: 400;
        --font-morph-serif-weight: 400;
        --font-morph-serif-optical-size: 104;
      }
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

const fixtureBuild = await build({
  entryPoints: [fileURLToPath(new URL('./fixture.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const [{ text: bundle }] = fixtureBuild.outputFiles
const workerBundle = await readFile(new URL('../dist/outline-worker.js', import.meta.url))

const sansFont = fixtureFont('Fixture Sans', false)
const serifFont = fixtureFont('Fixture Serif', true)
const sourceInstance = { role: 'sans', weight: 400, opticalSize: 0 }
const targetInstance = { role: 'serif', weight: 400, opticalSize: 104 }
const sourceInput = {
  data: sansFont.buffer.slice(sansFont.byteOffset, sansFont.byteOffset + sansFont.byteLength),
}
const targetInput = {
  data: serifFont.buffer.slice(serifFont.byteOffset, serifFont.byteOffset + serifFont.byteLength),
}
const outlineManifest = await compileFontMorphManifest(
  {
    sans: [sourceInput.data],
    serif: [targetInput.data],
  },
  [
    {
      text: 'ee',
      source: sourceInstance,
      target: targetInstance,
    },
  ],
)
const sourceParsed = parseFontMorphFont(sourceInput)
const targetParsed = parseFontMorphFont(targetInput)
const [sdfGlyph] = compileSdfGlyphPairs(sourceInput, targetInput, ['e'], {
  size: 64,
  pixelsPerEm: 512,
  maximumDistance: 64,
  supersampling: 4,
})
const serializeEndpoint = ({ distance, ...endpoint }) => ({
  ...endpoint,
  distanceBase64: Buffer.from(distance).toString('base64'),
})
const preparedManifest = {
  version: 2,
  outlines: outlineManifest.outlines,
  sdfMorphs: {
    [fontMorphPreparedKey('ee', sourceInstance, targetInstance)]: {
      sourceRun: shapeFontMorphInstantiatedRun(sourceParsed.outlineFont, {
        text: 'ee',
        fontInstanceId: sourceParsed.instance.id,
        language: 'en',
      }),
      targetRun: shapeFontMorphInstantiatedRun(targetParsed.outlineFont, {
        text: 'ee',
        fontInstanceId: targetParsed.instance.id,
        language: 'en',
      }),
      glyphs: {
        e: {
          ...sdfGlyph,
          source: serializeEndpoint(sdfGlyph.source),
          target: serializeEndpoint(sdfGlyph.target),
        },
      },
    },
  },
}

const assets = new Map([
  ['/', ['text/html; charset=utf-8', Buffer.from(html)]],
  ['/bundle.js', ['text/javascript; charset=utf-8', Buffer.from(bundle)]],
  ['/outline-worker.js', ['text/javascript; charset=utf-8', workerBundle]],
  [
    '/prepared.json',
    ['application/json; charset=utf-8', Buffer.from(JSON.stringify(preparedManifest))],
  ],
  ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]],
  [
    '/styles.css',
    ['text/css; charset=utf-8', Buffer.from(await readFile(new URL('../styles.css', import.meta.url)))],
  ],
  ['/sans.otf', ['font/otf', sansFont]],
  ['/serif.otf', ['font/otf', serifFont]],
  ['/sans-outline.otf', ['font/otf', sansFont]],
  ['/serif-outline.otf', ['font/otf', serifFont]],
])

const requests = new Map()

const server = createServer((request, response) => {
  requests.set(request.url, (requests.get(request.url) ?? 0) + 1)
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
  assert.equal(requests.get('/sans-outline.otf') ?? 0, 0, 'prepared text should not fetch outlines')
  assert.equal(requests.get('/serif-outline.otf') ?? 0, 0, 'prepared text should not fetch outlines')
  assert.equal(await page.evaluate(() => window.fontMorphFixture.start()), true)

  await page.waitForSelector('.font-morph-layer[data-font-morph-renderer="sdf"]', {
    state: 'attached',
  })
  const samples = []
  for (let index = 0; index < 8; index += 1) {
    if (index === 3) {
      await page.setViewportSize({ width: 760, height: 620 })
      await page.evaluate(() => window.fontMorphFixture.moveDestination())
    }
    samples.push(
      await page.evaluate(() => {
        const layer = document.querySelector('.font-morph-layer')
        if (!(layer instanceof HTMLCanvasElement)) return null
        const pixels = layer.getContext('2d')?.getImageData(0, 0, layer.width, layer.height).data
        if (!pixels) return null
        let alphaPixels = 0
        let minX = layer.width
        let minY = layer.height
        let maxX = -1
        let maxY = -1
        let hash = 2_166_136_261
        for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
          const alpha = pixels[pixel * 4 + 3]
          hash = Math.imul(hash ^ alpha, 16_777_619) >>> 0
          if (!alpha) continue
          alphaPixels += 1
          const x = pixel % layer.width
          const y = Math.floor(pixel / layer.width)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
        const endpoint = document.querySelector('[data-font-morph="sample"]')
        return {
          renderer: layer.dataset.fontMorphRenderer,
          hash,
          alphaPixels,
          inkBounds: { minX, minY, maxX, maxY },
          canvas: { width: layer.width, height: layer.height },
          endpoint: endpoint?.getBoundingClientRect().toJSON(),
          active: document.documentElement.dataset.fontMorphActive,
        }
      }),
    )
    await page.waitForTimeout(65)
  }

  // Resizing a real browser can outlast the fixture's animation on slower CI
  // machines. Completed frames are valid; inspect every sample captured while
  // the morph layer was still active.
  const activeSamples = samples.filter(Boolean)
  assert(activeSamples.length >= 5, 'the live morph should expose enough frames to inspect')
  assert(
    activeSamples.every((sample) => sample.renderer === 'sdf' && sample.alphaPixels > 0),
    'every active distance-field frame should contain visible ink',
  )
  assert(
    new Set(activeSamples.map((sample) => sample.hash)).size >= 4,
    'distance fields should interpolate across frames',
  )
  assert(
    activeSamples.some((sample) => sample.canvas.width === 900) &&
      activeSamples.some((sample) => sample.canvas.width === 760),
    'the renderer should resize with the viewport during the transition',
  )
  assert(
    new Set(activeSamples.map((sample) => sample.inkBounds.minX)).size >= 3,
    'the interpolated ink should track a destination that moves during the transition',
  )
  assert(
    activeSamples.every(
      (sample) => sample.inkBounds.maxX >= sample.inkBounds.minX,
    ),
    'every rendered frame should retain a non-empty ink box',
  )

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
  assert.doesNotMatch(
    JSON.stringify(await page.evaluate(() => window.fontMorphFixture.events[0])),
    /distanceBase64|glyphs|sdfMorphs/,
    'recordings should contain only the semantic transition event, never build geometry',
  )
  assert.equal(requests.get('/sans-outline.otf') ?? 0, 0, 'forward morph should use prepared data')

  // The tracking assertion above deliberately moved the destination to an
  // uncompiled optical size. Restore the compiled endpoint before exercising
  // the reverse prepared-data path; worker fallback is tested separately.
  await page.evaluate(() =>
    document.querySelector('[data-font-morph="sample"]')?.classList.remove('moved'),
  )
  assert.equal(await page.evaluate(() => window.fontMorphFixture.reverse()), true)
  await page.waitForSelector('.font-morph-layer[data-font-morph-renderer="sdf"]', {
    state: 'attached',
  })
  await page.waitForFunction(() => !document.querySelector('.font-morph-layer'), null, {
    timeout: 3_000,
  })
  assert.equal(
    await page.evaluate(() => document.querySelector('[data-font-morph="sample"]')?.classList.contains('sans')),
    true,
    'the same routine should morph in both font directions',
  )
  assert.equal(requests.get('/sans-outline.otf') ?? 0, 0, 'reverse morph should use prepared data')

  await page.evaluate(async () => {
    window.fontMorphFixture.show('serif')
    await window.fontMorphFixture.prepareReplay()
  })
  assert.equal(
    requests.get('/sans-outline.otf') ?? 0,
    0,
    `replay preparation should use prepared data: ${JSON.stringify(
      await page.evaluate(() => window.fontMorphFixture.workerRequests),
    )}`,
  )
  const replayFrameAt = (time) =>
    page.evaluate((replayTime) => {
      window.fontMorphFixture.replayAt(replayTime)
      const layer = document.querySelector('.font-morph-director-layer')
      if (!(layer instanceof HTMLCanvasElement)) return null
      const pixels = layer.getContext('2d')?.getImageData(0, 0, layer.width, layer.height).data
      if (!pixels) return null
      let alphaPixels = 0
      let hash = 2_166_136_261
      for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
        const alpha = pixels[pixel * 4 + 3]
        hash = Math.imul(hash ^ alpha, 16_777_619) >>> 0
        if (alpha) alphaPixels += 1
      }
      return { renderer: layer.dataset.fontMorphRenderer, hash, alphaPixels }
    }, time)
  const early = await replayFrameAt(120)
  const middle = await replayFrameAt(320)
  const late = await replayFrameAt(520)
  assert.equal(early?.renderer, 'sdf')
  assert((early?.alphaPixels ?? 0) > 0)
  assert.notDeepEqual(early, middle)
  assert.notDeepEqual(middle, late)
  await replayFrameAt(580)
  assert.deepEqual(
    await replayFrameAt(120),
    early,
    'rewinding should reconstruct distance fields solely from replay time',
  )
  await page.evaluate(() => window.fontMorphFixture.stopReplay())
  assert.equal(await page.locator('.font-morph-director-layer').count(), 0)
  assert.equal(
    requests.get('/sans-outline.otf') ?? 0,
    0,
    'prepared live and replay paths should stay off the compiler worker',
  )
  assert.equal(requests.get('/serif-outline.otf') ?? 0, 0)

  await page.evaluate(() => window.fontMorphFixture.prepareUnknown())
  assert.equal(requests.get('/sans-outline.otf'), 1, 'unknown text should use the worker fallback')
  assert.equal(requests.get('/serif-outline.otf'), 1, 'unknown text should use the worker fallback')
  assert.deepEqual(errors, [])

  console.log(`font-morph browser checks passed (preparation ${preparation.toFixed(1)}ms)`)
} finally {
  await closeBrowser?.()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
