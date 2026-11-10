import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from 'playwright-core'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:4178'
const engines = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  msedge: () => chromium.launch({ channel: 'msedge' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'webkit']) {
  const browser = await engines[name]()
  try {
    for (const locale of ['en', 'es', 'ja']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 700 },
        hasTouch: true,
      })
      await context.addInitScript(() => {
        window.__hashFrames = []
        const sample = () => {
          const body = document.body
          const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
          if (body && target && window.__hashFrames.length < 600) {
            const style = getComputedStyle(body)
            if (style.visibility === 'visible' && Number(style.opacity) > 0) {
              window.__hashFrames.push({
                y: scrollY,
                top: target.getBoundingClientRect().top,
                height: target.getBoundingClientRect().height,
                arrows: [...document.querySelectorAll('.back-to-top')].filter(
                  (node) => getComputedStyle(node).display !== 'none',
                ).length,
                open: target instanceof HTMLDetailsElement ? target.open : null,
              })
            }
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      let delayUntil = 0
      let blockScripts = false
      await page.route('**/*', async (route) => {
        const type = route.request().resourceType()
        if (type === 'script' && blockScripts) return route.abort()
        if (type === 'font' || type === 'script') {
          const delay = delayUntil - Date.now()
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        }
        await route.continue()
      })
      async function check(label) {
        await page.waitForFunction(
          () =>
            !document.documentElement.hasAttribute('data-initial-hash') &&
            !document.documentElement.hasAttribute('data-initial-reading'),
        )
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(700)
        const frames = await page.evaluate(() => window.__hashFrames)
        assert.ok(frames.length > 2, `${label}: visible frames recorded`)
        const final = frames.at(-1)
        for (const frame of frames) {
          assert.ok(
            Math.abs(frame.y - final.y) <= 1,
            `${label}: scroll changed ${JSON.stringify({ frame, final })}`,
          )
          assert.ok(
            Math.abs(frame.top - final.top) <= 1,
            `${label}: anchor moved ${JSON.stringify({ frame, final })}`,
          )
          assert.ok(Math.abs(frame.height - final.height) <= 1, `${label}: layout changed`)
          assert.equal(frame.arrows, final.arrows, `${label}: arrows flickered`)
          assert.equal(frame.open, final.open, `${label}: disclosure changed`)
        }
        if (final.y > 0 && (await page.locator('.back-to-top').count()) > 0)
          assert.ok(final.arrows > 0, `${label}: arrows visible before hydration`)
        assert.deepEqual(errors, [])
      }
      for (const path of [
        '/resume#education',
        '/resume#experience',
        '/resume#skills',
        '#contact',
        '/publications#sweetdeep',
      ]) {
        // A same-document hash change is not a fresh SSR navigation.
        await page.goto('about:blank')
        delayUntil = Date.now() + 1000
        await page.goto(`${base}/${locale}${path}`, { waitUntil: 'networkidle' })
        await check(`${name} ${locale}${path} direct`)
        // A reload starts with fresh cards, even if the previous document had
        // an expanded card above the target and a different reading offset.
        await page.evaluate(() => {
          const details = document.querySelector('details')
          if (details) details.open = true
          scrollBy({ top: 70, behavior: 'instant' })
        })
        await page.waitForTimeout(100)
        delayUntil = Date.now() + 1000
        await page.reload({ waitUntil: 'networkidle' })
        await check(`${name} ${locale}${path} refresh`)
      }
      blockScripts = true
      await page.goto(`${base}/${locale}/resume#experience`, { waitUntil: 'networkidle' })
      await check(`${name} ${locale} SSR without hydration`)
      console.log(
        `${name} ${locale}: stable visible frames on direct loads, refreshes, and blocked hydration`,
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
