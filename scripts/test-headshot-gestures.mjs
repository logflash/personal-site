import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright-core'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:4178'
for (const [name, engine, options] of [
  ['Edge', chromium, { channel: 'msedge' }],
  ['Chrome', chromium, { channel: 'chrome' }],
  ['WebKit', webkit, {}],
].filter(([name]) => !process.env.TEST_BROWSER || process.env.TEST_BROWSER === name)) {
  const browser = await engine.launch({ ...options, headless: true })
  try {
    for (const touch of [false, true]) {
      const context = await browser.newContext({
        viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        hasTouch: touch,
      })
      // The image bytes and noindex headers are checked separately; this suite
      // exercises native popup handling without repeatedly downloading 19 MB.
      await context.route('**/headshot.png', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'Headshot destination',
        }),
      )
      const page = await context.newPage()
      await page.addInitScript(() => {
        window.headshotFocusRequests = 0
        const open = window.open.bind(window)
        window.open = (...args) => {
          const tab = open(...args)
          if (tab) {
            const focus = tab.focus.bind(tab)
            tab.focus = () => {
              window.headshotFocusRequests++
              focus()
            }
          }
          return tab
        }
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      const recorderRequests = []
      page.on('request', (request) => {
        if (/\/RecordingRuntime[.-]/.test(request.url())) recorderRequests.push(request.url())
      })
      const avatar = () => page.locator('.avatar-hold:visible')
      const open = async (action) => {
        const focusRequests = await page.evaluate(() => window.headshotFocusRequests)
        const popupPromise = context.waitForEvent('page')
        await action()
        const popup = await popupPromise
        await popup.waitForURL(`${base}/headshot.png`)
        await popup.waitForLoadState('domcontentloaded')
        assert.equal(await popup.evaluate(() => window.opener), null)
        assert.equal(
          await page.evaluate(() => window.headshotFocusRequests),
          focusRequests + 1,
          'each photo gesture must request foreground focus',
        )
        await popup.close()
        assert.equal(context.pages().length, 1)
      }
      for (const locale of ['en', 'es', 'ja']) {
        await page.goto(`${base}/${locale}`, { waitUntil: 'networkidle' })
        if (touch) {
          await avatar().tap()
          await avatar().tap()
          assert.equal(context.pages().length, 1, 'one or two taps must not open the headshot')
          await open(() => avatar().tap())
          await avatar().tap()
          await page.waitForTimeout(500)
          await avatar().tap()
          await avatar().tap()
          assert.equal(context.pages().length, 1, 'a pause resets the tap sequence')
          await page.waitForTimeout(500)
        } else {
          await avatar().click()
          assert.equal(context.pages().length, 1, 'ordinary click is unchanged')
          for (const modifier of ['Control', 'Meta']) {
            await open(() => avatar().click({ modifiers: [modifier] }))
          }
        }
        assert.equal(page.url(), `${base}/${locale}`, 'original tab stays on the site')
      }
      assert.deepEqual(recorderRequests, [], 'photo gestures must not load the recorder')
      if (!touch) {
        await page.setViewportSize({ width: 390, height: 844 })
        await open(() => avatar().click({ modifiers: ['Control'], delay: 1100 }))
        assert.deepEqual(recorderRequests, [], 'holding Ctrl+click must not prepare recording')
      }

      // A real held gesture still starts gt-rrweb. Synthetic pointer events
      // let the same hold test run in all three browser engines.
      await page.goto(`${base}/en`, { waitUntil: 'networkidle' })
      const pointer = {
        pointerId: 1,
        pointerType: touch ? 'touch' : 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1,
      }
      await avatar().dispatchEvent('pointerdown', pointer)
      await page.waitForTimeout(1150)
      await avatar().dispatchEvent('pointerup', { ...pointer, buttons: 0 })
      await page
        .getByRole('button', { name: 'Stop recording', exact: true })
        .waitFor({ state: 'visible', timeout: 30_000 })
      assert.equal(context.pages().length, 1, 'holding must not open the photo')
      assert.deepEqual(errors, [])
      console.log(
        name,
        touch ? 'touch' : 'desktop + compact desktop',
        'photo gestures and recording hold passed',
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
