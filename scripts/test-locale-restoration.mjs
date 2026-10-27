import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({
  channel: process.env.TEST_BROWSER ?? 'chrome',
  headless: true,
})
const errors = []
const anchor = 'resume:Princeton University:Sep 2021–May 2025'

async function settled(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  )
  await page.waitForFunction(() => getComputedStyle(document.body).opacity === '1')
  await page.waitForTimeout(100)
}

try {
  for (const width of [1440, 390]) {
    for (const [locale, next] of [
      ['en', 'es'],
      ['es', 'ja'],
      ['ja', 'en'],
    ]) {
      for (const position of ['middle', 'inside', 'bottom']) {
        const context = await browser.newContext({ viewport: { width, height: 850 } })
        // Observe every animation frame from the start of the new document,
        // including SSR before hydration. A final scroll assertion alone misses
        // the top-of-page flash this regression is intended to catch.
        await context.addInitScript(
          ({ anchor }) => {
            window.__readingFrames = []
            function sample() {
              const body = document.body
              const main = document.querySelector('main')
              if (body && main && window.__readingFrames.length < 500) {
                const style = getComputedStyle(body)
                const entry = [...document.querySelectorAll('[data-reading-anchor]')].find(
                  (element) => element.dataset.readingAnchor === anchor,
                )
                window.__readingFrames.push({
                  visible: style.visibility === 'visible' && Number(style.opacity) > 0,
                  y: scrollY,
                  bottom: document.documentElement.scrollHeight - innerHeight - scrollY,
                  anchorY: entry?.getBoundingClientRect().top,
                  boxes: [...document.querySelectorAll('.resume-entry')].map((node) => node.open),
                  skills: [...document.querySelectorAll('.resume-skill-card-toggle')].map((node) =>
                    node.getAttribute('aria-expanded'),
                  ),
                })
              }
              requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
          },
          { anchor },
        )
        const page = await context.newPage()
        page.on('pageerror', (error) => errors.push(error.message))
        let scriptReadyAt = 0
        let fontsReadyAt = 0
        // Cold, slow destination resources expose both the SSR/hydration race
        // and the font-metric race. Delays share a deadline, so they don't stack.
        await page.route('**/*', async (route) => {
          const request = route.request()
          const deadline =
            request.resourceType() === 'script'
              ? scriptReadyAt
              : request.resourceType() === 'font'
                ? fontsReadyAt
                : 0
          const delay = deadline - Date.now()
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
          await route.continue()
        })
        await page.goto(`${base}/${locale}/resume${position === 'bottom' ? '#experience' : ''}`)
        await settled(page)
        for (const index of [1, 2]) {
          await page
            .locator('#education .resume-entry')
            .nth(index)
            .locator('summary')
            .evaluate((element) => element.click())
        }
        await page
          .locator('.resume-skill-card-toggle')
          .first()
          .evaluate((element) => element.click())
        await settled(page)
        await page.evaluate(
          ({ position, anchor }) => {
            const entry = [...document.querySelectorAll('[data-reading-anchor]')].find(
              (element) => element.dataset.readingAnchor === anchor,
            )
            if (!entry) throw new Error(`Missing reading anchor: ${anchor}`)
            scrollTo({
              top:
                position === 'bottom'
                  ? document.documentElement.scrollHeight
                  : scrollY +
                    entry.getBoundingClientRect().top -
                    (position === 'inside' ? -120 : 80),
              behavior: 'instant',
            })
          },
          { position, anchor },
        )
        const before = await page.evaluate(() => ({
          boxes: [...document.querySelectorAll('.resume-entry')].map((node) => node.open),
          skills: [...document.querySelectorAll('.resume-skill-card-toggle')].map((node) =>
            node.getAttribute('aria-expanded'),
          ),
        }))
        scriptReadyAt = Date.now() + 700
        fontsReadyAt = Date.now() + 1200
        // Do not let Playwright scroll the mobile selector into view first.
        await page.locator('.locale-switcher:visible').evaluate((switcher, locale) => {
          const native = switcher.querySelector('select')
          if (getComputedStyle(native).display !== 'none') {
            native.value = locale
            native.dispatchEvent(new Event('change', { bubbles: true }))
          } else switcher.querySelector(`[data-locale="${locale}"]`).click()
        }, next)
        await page.waitForURL(`${base}/${next}/resume${position === 'bottom' ? '#experience' : ''}`)
        await settled(page)
        const frames = await page.evaluate(() => window.__readingFrames)
        const visible = frames.filter((frame) => frame.visible)
        assert.ok(
          frames.some((frame) => !frame.visible),
          'destination waits for its restored layout',
        )
        assert.ok(visible.length, 'destination becomes visible')
        for (const frame of visible) {
          assert.deepEqual(frame.boxes, before.boxes, 'no visible frame with reset disclosures')
          assert.deepEqual(frame.skills, before.skills, 'no visible frame with reset skill cards')
          assert.ok(
            Math.abs(
              position === 'bottom'
                ? frame.bottom
                : frame.anchorY - (position === 'inside' ? -120 : 80),
            ) <= 3,
            `${locale} → ${next}, ${width}px, ${position}: incorrect visible frame ${JSON.stringify(frame)}`,
          )
        }
        console.log(
          `${locale} → ${next}, ${width}px, ${position}: first visible frame and ${visible.length} subsequent frames restored correctly`,
        )
        await context.close()
      }
    }
  }
  assert.deepEqual(errors, [], 'browser/hydration errors')
} finally {
  await browser.close()
}
