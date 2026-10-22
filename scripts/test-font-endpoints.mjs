import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { PNG } from '../repos/glyphflux/node_modules/pngjs/lib/png.js'

// Uses Vite's source imports to exercise the real gt-rrweb replay director.
const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
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
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
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
