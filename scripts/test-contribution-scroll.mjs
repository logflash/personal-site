import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from 'playwright-core'
const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
for (const [name, engine, options] of [
  ['Edge', chromium, { channel: 'msedge' }],
  ['Chrome', chromium, { channel: 'chrome' }],
  ['Firefox', firefox, {}],
  ['WebKit', webkit, {}],
]) {
  const browser = await engine.launch({ ...options, headless: true })
  try {
    for (const blocked of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
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
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.setViewportSize({ width: 320, height: 844 })
      assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
      console.log(
        name,
        blocked ? 'blocked storage' : 'normal storage',
        'right edge, stopped animation, backward scroll, resize passed; initial',
        initial,
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
