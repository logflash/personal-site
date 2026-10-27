import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const engines = { chrome: chromium, msedge: chromium, firefox, webkit }
const names = process.env.TEST_BROWSER ? [process.env.TEST_BROWSER] : Object.keys(engines)
for (const name of names) {
  const browser = await engines[name].launch({
    headless: true,
    ...(['chrome', 'msedge'].includes(name) ? { channel: name } : {}),
  })
  try {
    for (const { width, hasTouch } of [
      { width: 390, hasTouch: true },
      { width: 390, hasTouch: false },
      { width: 1440, hasTouch: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const locale of ['en', 'es', 'ja']) {
        await page.goto(`${base}/${locale}`, { waitUntil: 'networkidle' })
        if (hasTouch) {
          const native = page.locator('.locale-switcher-native:visible')
          assert.equal(await native.inputValue(), locale)
          assert.equal(await page.locator('.locale-switcher-trigger:visible').count(), 0)
          assert.equal(await native.evaluate((el) => getComputedStyle(el).textAlignLast), 'center')
          await native.tap()
          await page.keyboard.press('Escape')
          assert.equal(
            await page.locator('.locale-switcher-options:visible').count(),
            0,
            'mobile retains the browser picker',
          )
          console.log(`${name} ${width}px ${locale}: native mobile selector retained`)
          continue
        }
        const trigger = page.locator('.locale-switcher-trigger:visible')
        const menu = page.locator('.locale-switcher:visible .locale-switcher-options')
        await trigger.click()
        await menu.waitFor({ state: 'visible' })
        const positions = await menu.locator('a').evaluateAll((links) =>
          links.map((link) => {
            const range = document.createRange()
            range.selectNodeContents(link)
            const text = range.getBoundingClientRect()
            const row = link.getBoundingClientRect()
            const picker = link.parentElement.getBoundingClientRect()
            return {
              text: link.textContent,
              offset: text.x + text.width / 2 - (picker.x + picker.width / 2),
              rowOffset: row.x + row.width / 2 - (picker.x + picker.width / 2),
            }
          }),
        )
        for (const position of positions) {
          assert.ok(
            Math.abs(position.offset) < 0.6,
            `${name} ${width} ${position.text}: ${position.offset}px from center`,
          )
          assert.ok(Math.abs(position.rowOffset) < 0.6, 'each option occupies a centered row')
        }
        const menuBox = await menu.boundingBox()
        assert.ok(menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= width + 1)
        assert.equal(
          await menu.locator('[aria-current="true"]').getAttribute('data-locale'),
          locale,
        )
        await menu.screenshot({ path: `tmp/locale-picker-${name}-${width}-${locale}.png` })
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'hidden' })
        assert.equal(await menu.isVisible(), false)
        assert.equal(await trigger.evaluate((el) => el === document.activeElement), true)

        await trigger.press('ArrowDown')
        assert.equal(await menu.locator('a:focus').getAttribute('data-locale'), 'en')
        await page.keyboard.press('End')
        assert.equal(await menu.locator('a:focus').getAttribute('data-locale'), 'ja')
        await page.keyboard.press('ArrowUp')
        assert.equal(await menu.locator('a:focus').getAttribute('data-locale'), 'es')
        await page.keyboard.press('Home')
        assert.equal(await menu.locator('a:focus').getAttribute('data-locale'), 'en')
        await page.keyboard.press('Escape')
        await trigger.press('Enter')
        await page.keyboard.press('Tab')
        // WebKit can follow the platform preference to skip links when tabbing.
        // Preserve that behavior; arrow navigation above always reaches them.
        if (await menu.isVisible()) {
          assert.equal(await menu.locator('a:focus').getAttribute('data-locale'), 'en')
        } else {
          assert.equal(await trigger.evaluate((el) => el === document.activeElement), false)
        }
        await page.keyboard.press('Escape')
        await trigger.click()
        await page.locator('main').click({ position: { x: 5, y: 5 } })
        assert.equal(await menu.isVisible(), false, 'outside clicks dismiss the menu')
        console.log(`${name} ${width}px ${locale}: all option centers and keyboard controls passed`)
      }
      // Exercise the real full-document locale navigation, including query/hash.
      await page.goto(`${base}/en/resume?picker-test=1#experience`, { waitUntil: 'networkidle' })
      if (hasTouch) {
        await page.locator('.locale-switcher-native:visible').selectOption('es')
      } else {
        // Keep the anchored reading position: Playwright scrolling the compact
        // header into view would legitimately update the page's active hash.
        await page.locator('.locale-switcher-trigger:visible').evaluate((button) => button.click())
        const options = page.locator('.locale-switcher:visible .locale-switcher-options')
        assert.equal(
          await options.locator('[data-locale="es"]').getAttribute('href'),
          '/es/resume?picker-test=1#experience',
        )
        await options.locator('[data-locale="es"]').evaluate((link) => link.click())
      }
      await page.waitForURL(`${base}/es/resume?picker-test=1#experience`)
      await page.waitForLoadState('networkidle')
      if (hasTouch)
        assert.equal(await page.locator('.locale-switcher-native:visible').inputValue(), 'es')
      else
        assert.equal(
          await page.locator('.locale-switcher-trigger:visible').textContent(),
          'Español',
        )
      assert.ok(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === 'generaltranslation.locale' && cookie.value === 'es',
        ),
      )
      if (!hasTouch) await page.locator('.locale-switcher-trigger:visible').click()
      const accessibility = await new AxeBuilder({ page }).include('.locale-switcher').analyze()
      assert.deepEqual(
        accessibility.violations.map(({ id }) => id),
        [],
        'language controls remain accessible',
      )
      assert.deepEqual(errors, [], 'no browser or hydration errors')
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
