import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { PNG } from '../repos/glyphflux/node_modules/pngjs/lib/png.js'

// Uses Vite's source imports to exercise the real gt-rrweb replay director.
const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({
  channel: process.env.FONT_ENDPOINT_BROWSER ?? 'chrome',
  headless: true,
})
async function assertNotFoundMorph(page, locale, width) {
  await page.goto(`${baseUrl}/${locale}/missing-page`, { waitUntil: 'networkidle' })
  await page.locator('.not-found-specimen[data-ready]').waitFor()
  await page.addScriptTag({ path: 'node_modules/@rrweb/record/umd/record.js' })
  await page.evaluate(() => {
    window.__notFoundEvents = []
    window.__stopNotFoundRecording = window.rrwebRecord.record({
      emit: (event) => window.__notFoundEvents.push(event),
      inlineStylesheet: false,
    })
  })
  // Control the real component's clock, including the final animation frame.
  await page.evaluate(() => {
    window.__notFoundNow = 1000
    window.__notFoundQueue = new Map()
    let next = 1
    performance.now = () => window.__notFoundNow
    window.requestAnimationFrame = (callback) => {
      const id = next++
      window.__notFoundQueue.set(id, callback)
      return id
    }
    window.cancelAnimationFrame = (id) => window.__notFoundQueue.delete(id)
    window.__step404 = (time) => {
      window.__notFoundNow = time
      const callbacks = [...window.__notFoundQueue.values()]
      window.__notFoundQueue.clear()
      callbacks.forEach((callback) => callback(time))
    }
  })
  const box = await page.locator('.not-found-specimen-stage').boundingBox()
  const clip = {
    x: Math.floor(box.x),
    y: Math.floor(box.y),
    width: Math.ceil(box.width),
    height: Math.ceil(box.height),
  }
  let start = 1000
  const button = page.locator('.not-found-specimen')
  const activate = () => (width < 600 ? button.tap() : button.click())
  const step = (time) => page.evaluate((value) => window.__step404(value), time)
  const artwork = () => page.screenshot({ clip })
  for (const direction of ['sans', 'serif']) {
    await activate()
    const shapes = new Set()
    let last
    for (const progress of [0.05, 0.25, 0.5, 0.75, 0.95, 0.999999, 1]) {
      await page.evaluate((time) => window.__step404(time), start + 760 * progress)
      const screenshot = await page.screenshot({ clip })
      assert.equal(
        inkHoles(screenshot),
        3,
        `${locale} ${width}px ${direction}: three counters at ${progress}`,
      )
      const state = await page.evaluate(() => ({
        opacities: [...document.querySelectorAll('.not-found-specimen-stage > span')].map(
          (el) => getComputedStyle(el).opacity,
        ),
        shape: document.querySelector('.not-found-artwork path').getAttribute('d'),
      }))
      assert.deepEqual(state.opacities, ['0', '0'], 'native endpoints never flash')
      shapes.add(state.shape)
      if (progress === 0.999999) last = screenshot
      if (progress === 1) {
        const before = PNG.sync.read(last)
        const after = PNG.sync.read(screenshot)
        let difference = 0
        for (let i = 0; i < before.data.length; i++) {
          difference += Math.abs(before.data[i] - after.data[i])
        }
        assert.ok(
          difference / inkMass(screenshot) < 0.001,
          'the final frame must retain the same rendered outline',
        )
      }
    }
    assert.ok(shapes.size > 4, 'the outline changes gradually')
    await page.waitForFunction(() => !document.querySelector('.not-found-specimen').disabled)
    assert.equal(await page.locator('.not-found-specimen').getAttribute('data-typeface'), direction)
    console.log(`${locale} ${width}px ${direction}: continuous 404 endpoint passed.`)
    start += 760
  }

  // Reversing must retrace the visible shape in both directions, without a
  // native endpoint flash, a restarted easing pause, or competing RAF loops.
  for (const direction of ['sans', 'serif']) {
    const resting = await artwork()
    await activate()
    assert.equal(await button.isEnabled(), true, 'the moving specimen stays interactive')
    await step(start + 190)
    const quarter = await artwork()
    await step(start + 456)
    const turning = await artwork()
    await activate()
    assertArtworkMatches(turning, await artwork(), 'reversing must not jump to another shape')
    await step(start + 472)
    assert.notDeepEqual(await artwork(), turning, 'reversal must move on the next frame')
    await step(start + 722)
    assertArtworkMatches(quarter, await artwork(), 'reversal retraces the same eased timeline')
    await step(start + 913)
    assertArtworkMatches(resting, await artwork(), 'reversal returns to the original endpoint')
    assert.equal(inkHoles(await artwork()), 3, 'reversing retains all three counters')
    start += 1000
    await step(start)
    await activate()
    await step(start + 760)
    assert.equal(await button.getAttribute('data-typeface'), direction)
    start += 760
  }

  const restingSerif = await artwork()
  await activate()
  await step(start + 380)
  const middle = await artwork()
  for (let tap = 0; tap < 7; tap++) {
    await activate()
    assertArtworkMatches(middle, await artwork(), 'rapid reversals keep the current frame')
  }
  await step(start + 761)
  assertArtworkMatches(restingSerif, await artwork(), 'rapid reversals settle at the latest target')
  await step(start + 1520)
  assertArtworkMatches(restingSerif, await artwork(), 'cancelled animation frames cannot resume')
  console.log(`${locale} ${width}px: mid-animation and rapid reversals passed.`)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await button.focus()
  await page.keyboard.press('Enter')
  assert.equal(await button.getAttribute('data-typeface'), 'sans')
  const reducedSans = await artwork()
  assert.notDeepEqual(reducedSans, restingSerif, 'reduced motion switches immediately')
  await step(start + 2280)
  assertArtworkMatches(reducedSans, await artwork(), 'reduced motion schedules no animation')
  await page.keyboard.press('Space')
  assertArtworkMatches(
    restingSerif,
    await artwork(),
    'keyboard activation restores serif immediately',
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const paths = await page
    .locator('.not-found-artwork path')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))
  const events = await page.evaluate(() => {
    window.__stopNotFoundRecording()
    return window.__notFoundEvents
  })
  assert.ok(
    events.some(
      (event) =>
        event.type === 3 && event.data.attributes?.some((mutation) => mutation.attributes.d),
    ),
    'rrweb must record the persistent outline animation',
  )
  const replay = await browser.newPage({ viewport: { width, height: 1000 } })
  try {
    await replay.goto(`${baseUrl}/robots.txt`)
    await replay.setContent('<body></body>')
    await replay.addScriptTag({ path: 'node_modules/@rrweb/replay/umd/replay.js' })
    await replay.evaluate((recorded) => {
      const player = new window.rrwebReplay.Replayer(recorded, { root: document.body })
      player.pause(recorded.at(-1).timestamp - recorded[0].timestamp + 1)
    }, events)
    await replay.waitForFunction(() =>
      document.querySelector('iframe')?.contentDocument?.querySelector('.not-found-artwork path'),
    )
    const replayPaths = await replay.evaluate(() =>
      [
        ...document
          .querySelector('iframe')
          .contentDocument.querySelectorAll('.not-found-artwork path'),
      ].map((node) => node.getAttribute('d')),
    )
    assert.deepEqual(replayPaths, paths, 'rrweb must retain the exact settled serif outline')
  } finally {
    await replay.close()
  }
}

function assertArtworkMatches(expected, actual, message) {
  const before = PNG.sync.read(expected)
  const after = PNG.sync.read(actual)
  let difference = 0
  for (let i = 0; i < before.data.length; i++) {
    difference += Math.abs(before.data[i] - after.data[i])
  }
  assert.ok(difference / inkMass(actual) < 0.001, message)
}

function inkHoles(bytes) {
  const { data, width, height } = PNG.sync.read(bytes)
  const visited = new Uint8Array(width * height)
  const isInk = (pixel) => data[0] - data[pixel * 4] > 64
  let holes = 0
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || isInk(start)) continue
    const queue = [start]
    visited[start] = 1
    let area = 0
    let boundary = false
    while (queue.length) {
      const pixel = queue.pop()
      const x = pixel % width
      const y = Math.floor(pixel / width)
      area++
      boundary ||= x === 0 || y === 0 || x === width - 1 || y === height - 1
      for (const next of [pixel - 1, pixel + 1, pixel - width, pixel + width]) {
        if (next < 0 || next >= visited.length || visited[next] || isInk(next)) continue
        if (Math.abs((next % width) - x) + Math.abs(Math.floor(next / width) - y) !== 1) continue
        visited[next] = 1
        queue.push(next)
      }
    }
    if (!boundary && area > 4) holes++
  }
  return holes
}

function inkMass(bytes) {
  const { data } = PNG.sync.read(bytes)
  let mass = 0
  for (let i = 0; i < data.length; i += 4)
    for (let c = 0; c < 3; c++) mass += Math.max(0, data[c] - data[i + c])
  return mass
}
try {
  for (const locale of ['en', 'es', 'ja'])
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        hasTouch: width < 600,
      })
      await assertNotFoundMorph(page, locale, width)
      await page.goto(`${baseUrl}/${locale}`, { waitUntil: 'networkidle' })
      await page.locator('.colophon > summary').click()
      await page.locator('.type-specimen').scrollIntoViewIfNeeded()
      await page.evaluate(() => {
        window.__morphs = []
        window.__cloneFlash = false
        addEventListener('font-morph:record', (event) => window.__morphs.push(event.detail))
        const sample = () => {
          const layer = document.querySelector('.font-morph-target-layer')
          if (layer && getComputedStyle(layer).opacity === '1') window.__cloneFlash = true
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      for (const direction of ['serif', 'sans']) {
        await page.locator('.type-specimen').click()
        await page.waitForFunction(
          () => !document.documentElement.hasAttribute('data-font-morph-active'),
        )
        const payload = await page.evaluate(() => window.__morphs.at(-1))
        assert.equal(payload.target.style.fontRole, direction)
        assert.equal(payload.target.style.fontWeight, direction === 'sans' ? '400' : '600')
        assert.equal(
          await page.evaluate(() => window.__cloneFlash),
          false,
          'live endpoint flashes a transformed clone',
        )
        const box = await page.locator('.type-specimen-stage').boundingBox()
        const clip = {
          x: Math.floor(box.x),
          y: Math.floor(box.y) - 4,
          width: Math.ceil(box.width),
          height: Math.ceil(box.height) + 8,
        }
        await page.evaluate(async () => {
          const { createFontMorphReplayDirector, prepareFontMorphReplay } =
            await import('/repos/gt-rrweb/src/glyphflux.ts')
          const payload = window.__morphs.at(-1)
          window.__events = [
            { type: 4, timestamp: 0, data: { width: innerWidth, height: innerHeight } },
            { type: 5, timestamp: 100, data: { tag: 'font-morph', payload } },
          ]
          await prepareFontMorphReplay(window.__events, ['en'], (_, __, text) => text, document)
          window.__director = createFontMorphReplayDirector()
          window.__renderAt = (time) =>
            window.__director({
              document,
              events: window.__events,
              time,
              locale: 'en',
              overlayRoot: null,
            })
          window.__renderAt(100 + payload.duration * 0.999999)
        })
        assert.ok(
          await page.locator('canvas[data-font-morph-renderer="sdf"]').count(),
          'exercise actual prepared geometry',
        )
        const generated = inkMass(await page.screenshot({ clip }))
        await page.evaluate(() => window.__renderAt(100 + window.__morphs.at(-1).duration))
        assert.equal(await page.locator('.font-morph-director-layer').count(), 0)
        const native = inkMass(await page.screenshot({ clip }))
        const ratio = generated / native
        assert.ok(
          Math.abs(ratio - 1) < 0.15,
          `${locale} ${width} ${direction}: endpoint ink weight ratio ${ratio}`,
        )
        await page.evaluate(() => window.__renderAt(10000))
        console.log(
          `${locale} ${width}px ${direction}: live handoff and gt-rrweb endpoint weight passed (${ratio.toFixed(3)}).`,
        )
      }
      await page.close()
    }
} finally {
  await browser.close()
}
