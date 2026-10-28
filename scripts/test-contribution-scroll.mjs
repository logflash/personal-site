import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from 'playwright-core'
const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'

async function checkReload(page, expected) {
  // Hold the client bundle to prove the server-rendered graph is already in
  // place before hydration, then check every visible frame through hydration.
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const holdScripts = async (route) => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  }
  await page.route('**/*', holdScripts)
  try {
    await page.reload({ waitUntil: 'commit' })
    // WebKit can defer rAF polling while module requests are held open.
    await page.waitForFunction(() => window.graphPaints?.length > 0, undefined, { polling: 50 })
    const beforeHydration = await page.evaluate(() => window.graphPaints)
    assert.ok(
      beforeHydration.every((x) => Math.abs(x - expected) <= 1),
      `first visible frames before hydration: ${beforeHydration}, expected ${expected}`,
    )
  } finally {
    release()
  }
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const paints = await page.evaluate(() => window.graphPaints)
  assert.ok(
    paints.every((x) => Math.abs(x - expected) <= 1),
    `visible frames through hydration: ${paints}, expected ${expected}`,
  )
  await page.unroute('**/*', holdScripts)
}

for (const [name, engine, options] of [
  ['Edge', chromium, { channel: 'msedge' }],
  ['Chrome', chromium, { channel: 'chrome' }],
  ['Firefox', firefox, {}],
  ['WebKit', webkit, {}],
].filter(([name]) => !process.env.TEST_BROWSER || name === process.env.TEST_BROWSER)) {
  const browser = await engine.launch({ ...options, headless: true })
  try {
    for (const blocked of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      })
      await context.addInitScript(() => {
        window.graphPaints = []
        const sample = () => {
          const graph = document.querySelector('.cg-scroller')
          if (
            graph &&
            !document.documentElement.hasAttribute('data-initial-scroll') &&
            graph.scrollWidth > graph.clientWidth &&
            getComputedStyle(graph).visibility === 'visible'
          ) {
            window.graphPaints.push(graph.scrollLeft)
          }
        }
        // Observe the synchronous reveal as well as each rendering frame.
        new MutationObserver(sample).observe(document, {
          attributes: true,
          subtree: true,
          attributeFilter: ['data-initial-scroll'],
        })
        const frame = () => {
          sample()
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })
      if (blocked)
        await context.addInitScript(() => {
          Storage.prototype.setItem = () => {
            throw new Error('Blocked')
          }
          Storage.prototype.getItem = () => {
            throw new Error('Blocked')
          }
        })
      const page = await context.newPage()
      await page.goto(`${baseUrl}/en`, { waitUntil: 'networkidle' })
      const initial = await page.locator('.cg-scroller').evaluate((el) => ({
        left: el.scrollLeft,
        max: el.scrollWidth - el.clientWidth,
        cue: document.querySelector('.cg-scroll-hint').checkVisibility(),
      }))
      assert.ok(initial.max > 0)
      await page.locator('.cg-scroller').evaluate((el) => (el.scrollLeft = el.scrollWidth))
      await page.waitForFunction(() => document.querySelector('.cg-scroll-hint').hidden)
      assert.equal(
        await page.locator('.cg-scroll-hint').evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
      await page.locator('.cg-scroller').evaluate((el) => (el.scrollLeft = 0))
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
      if (blocked) {
        await checkReload(page, Math.max(0, initial.max - 96))
        await page.locator('.cg-scroller').evaluate((el) => (el.scrollLeft = el.scrollWidth))
        await page.waitForFunction(() => document.querySelector('.cg-scroll-hint').hidden)
      } else {
        for (const locale of ['en', 'es', 'ja']) {
          await page.goto(`${baseUrl}/${locale}`, { waitUntil: 'networkidle' })
          const graph = page.locator('.cg-scroller')
          const max = await graph.evaluate((el) => el.scrollWidth - el.clientWidth)
          for (const position of [0, Math.round(max / 2), max]) {
            await graph.evaluate((el, x) => {
              el.scrollLeft = x
            }, position)
            // No scrollend wait: pagehide must save even an immediate refresh.
            await checkReload(page, position)
          }
          assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.setViewportSize({ width: 320, height: 844 })
      assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
      console.log(
        name,
        blocked ? 'blocked storage' : 'normal storage',
        'right edge, stopped animation, backward scroll, resize, pre-hydration reload passed; initial',
        initial,
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
