import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, firefox, webkit } from 'playwright-core'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const engines = {
  chrome: () => chromium.launch({ channel: 'chrome', headless: true }),
  msedge: () => chromium.launch({ channel: 'msedge', headless: true }),
  firefox: () => firefox.launch({ headless: true }),
  webkit: () => webkit.launch({ headless: true }),
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(engines)) {
  const browser = await engines[name]()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 500 }, hasTouch: false })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const locale of ['en', 'es', 'ja']) {
      await page.goto(`${base}/${locale}#contact`, { waitUntil: 'networkidle' })
      await page.locator('#contact').scrollIntoViewIfNeeded()
      const historyLength = await page.evaluate(() => history.length)
      await page.locator('#contact .back-to-top').click()
      await page.waitForFunction(() => scrollY === 0 && location.hash === '')
      // Catch a delayed reading-position restoration undoing the click.
      await page.waitForTimeout(400)
      assert.equal(await page.evaluate(() => scrollY), 0)
      assert.equal(await page.evaluate(() => history.length), historyLength)
      assert.equal(await page.locator('.back-to-top').count(), 0)

      await page.goto(`${base}/${locale}/missing-page`, { waitUntil: 'networkidle' })
      await page.locator('.not-found-specimen[data-ready]').waitFor()
      await page.evaluate(() => scrollTo({ top: 80, behavior: 'instant' }))
      await page.locator('.not-found-page .back-to-top').click()
      await page.waitForFunction(() => scrollY === 0)
    }

    await page.goto(`${base}/en`, { waitUntil: 'networkidle' })
    await page.locator('.colophon > summary').click()
    await page.locator('.colophon-record').click()
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    await page.waitForFunction(() => document.documentElement.classList.contains('gt-recording'))
    // Firefox can carry the old document position into the new scroll frame.
    // Establish a sampled top position so the following scroll is an event,
    // rather than merely part of the recorder's initial full snapshot.
    await page
      .locator('.content')
      .evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(200)
    await page.locator('#contact').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('.content').scrollTop > 0)
    await page.locator('#contact .h-link').click()
    await page.waitForURL(`${base}/en#contact`)
    // Let rrweb's scroll sampling capture the nonzero position before returning.
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => scrollY), 0, 'only the capture column scrolls')
    await page.locator('#contact .back-to-top').click()
    await page.waitForFunction(() => document.querySelector('.content').scrollTop === 0)
    assert.equal(await page.evaluate(() => location.hash), '')
    await page.waitForFunction(() => !document.querySelector('.back-to-top'))
    await page.waitForTimeout(400)
    assert.equal(await page.locator('.content').evaluate((element) => element.scrollTop), 0)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.locator('.replay-overlay-box #stage iframe').waitFor({ timeout: 60000 })
    const downloaded = page.waitForEvent('download')
    await page.locator('#downloadJson').click()
    const bundle = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'))
    const scrolls = bundle.events.filter((event) => event.type === 3 && event.data.source === 3)
    const moved = scrolls.find((event) => event.data.y > 0)
    assert.ok(moved, 'rrweb records the scroll down inside the capture frame')
    assert.equal(
      scrolls.filter((event) => event.data.id === moved.data.id).at(-1).data.y,
      0,
      'the same recorded scroller returns to the top',
    )
    await page.locator('#track').evaluate((track) => {
      const rect = track.getBoundingClientRect()
      for (const type of ['pointerdown', 'pointerup']) {
        track.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: rect.right + 1,
            clientY: rect.y + rect.height / 2,
          }),
        )
      }
    })
    await page.waitForFunction(() => {
      const doc = document.querySelector('#stage iframe')?.contentDocument
      return doc?.querySelector('.content')?.scrollTop === 0 && !doc.querySelector('.back-to-top')
    })
    assert.deepEqual(errors, [])
    console.log(
      `${name}: compact mouse back-to-top passed in en/es/ja, 404, gt-rrweb recording and replay.`,
    )
  } finally {
    await browser.close()
  }
}
