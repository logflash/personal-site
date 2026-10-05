import assert from 'node:assert/strict'

export async function assertBrowserPreferences(browser, { baseUrl, createContext }) {
  for (const mobile of [false, true]) {
    const context = await createContext(browser, {
      reducedMotion: 'reduce',
      viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    })
    try {
      const page = await context.newPage()
      for (const locale of ['en', 'es', 'ja']) {
        await page.goto(`${baseUrl}/${locale}`, { waitUntil: 'networkidle' })
        const cell = page.locator('[data-contribution-date]').last()
        await cell.scrollIntoViewIfNeeded()
        if (mobile) await cell.tap()
        else await cell.hover()
        const styles = await cell.evaluate((el) => {
          const style = getComputedStyle(el)
          return {
            transform: style.transform,
            duration: style.transitionDuration,
            outline: style.outlineStyle,
          }
        })
        assert.deepEqual(styles, { transform: 'none', duration: '0s', outline: 'solid' })
        assert.equal(
          await page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior),
          'auto',
        )
        assert.equal(
          await page
            .locator('.cg-scroll-hint')
            .evaluate((el) => getComputedStyle(el).animationName),
          'none',
        )
        assert.ok(await page.locator('.cg-summary-slot').first().innerText())

        // Sample synchronously: reduced motion must reach the end immediately,
        // not merely finish a smooth scroll by the time a polling assertion runs.
        const scroll = await page.evaluate(() => {
          const scroller = document.querySelector('.cg-scroller')
          scroller.scrollLeft = 0
          document.querySelector('.cg-scroll-hint').click()
          return { left: scroller.scrollLeft, max: scroller.scrollWidth - scroller.clientWidth }
        })
        if (mobile) assert.ok(scroll.max > 0)
        assert.ok(Math.abs(scroll.left - scroll.max) <= 1)

        // A cancelled hold must still provide static feedback without starting
        // a recording or changing the one-second activation threshold.
        const avatar = page.locator(`${mobile ? '.mobile-header' : '.sidebar'} .avatar-hold`)
        await avatar.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, button: 0 })
        assert.equal(
          await avatar.locator('.avatar').evaluate((el) => getComputedStyle(el).transform),
          'none',
        )
        assert.equal(
          await avatar
            .locator('.ring-progress')
            .evaluate((el) => getComputedStyle(el).animationName),
          'none',
        )
        await avatar.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 7 })

        await page.evaluate(() => {
          window.__preferenceMorphEvents = 0
          window.addEventListener('font-morph:record', () => window.__preferenceMorphEvents++)
        })
        await page
          .locator(`${mobile ? '.pill-nav' : '.side-nav'} [data-page-link="resume"]`)
          .click()
        await page.waitForURL(`${baseUrl}/${locale}/resume`)
        assert.equal(await page.locator('html').getAttribute('data-font-morph-active'), null)
        assert.equal(await page.evaluate(() => window.__preferenceMorphEvents), 0)
        const toggle = page.locator('.resume-skill-card-toggle').first()
        for (const expanded of ['true', 'false']) {
          await toggle.click()
          assert.equal(await toggle.getAttribute('aria-expanded'), expanded)
          assert.equal(await page.locator('.resume-skill-migration-layer').count(), 0)
          assert.equal(
            await page
              .locator('.resume-skill-card')
              .first()
              .evaluate((el) => el.getAnimations({ subtree: true }).length),
            0,
          )
        }

        // Preference changes apply in the current document, without a reload.
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        assert.equal(
          await page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior),
          'smooth',
        )
        await page.emulateMedia({ reducedMotion: 'reduce' })
        console.log(
          `Browser motion preferences passed: ${mobile ? 'mobile' : 'desktop'} ${locale}.`,
        )
      }
    } finally {
      await context.close()
    }
  }

  const context = await createContext(browser, { colorScheme: 'dark', reducedMotion: 'reduce' })
  try {
    const page = await context.newPage()
    await page.goto(`${baseUrl}/en`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    assert.equal(await page.evaluate(() => localStorage.getItem('ian-site-theme')), null)
    assert.equal(
      await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme),
      'dark',
    )
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await page.locator('.theme-toggle:visible').click()
    assert.equal(await page.evaluate(() => localStorage.getItem('ian-site-theme')), 'dark')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    await page.locator('.theme-toggle:visible').click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')

    const otherTab = await context.newPage()
    await otherTab.goto(`${baseUrl}/en`, { waitUntil: 'networkidle' })
    await otherTab.evaluate(() => localStorage.removeItem('ian-site-theme'))
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await otherTab.close()

    await page.emulateMedia({ contrast: 'more' })
    assert.equal(
      await page
        .locator('.handle')
        .first()
        .evaluate((el) => getComputedStyle(el).color),
      await page.locator('body').evaluate((el) => getComputedStyle(el).color),
    )
    await page.emulateMedia({ forcedColors: 'active' })
    const cell = page.locator('[data-contribution-date]').last()
    await cell.scrollIntoViewIfNeeded()
    await cell.hover()
    assert.equal(await cell.evaluate((el) => getComputedStyle(el).borderTopStyle), 'solid')
    assert.equal(await cell.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid')
    assert.equal(await cell.evaluate((el) => getComputedStyle(el).forcedColorAdjust), 'auto')
    await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference' })

    // 320 CSS pixels is also the reflow width of a 1280px window at 400% zoom.
    await page.setViewportSize({ width: 320, height: 800 })
    for (const locale of ['en', 'es', 'ja']) {
      for (const route of ['', '/resume', '/publications', '/projects', '/missing-page']) {
        await page.goto(`${baseUrl}/${locale}${route}`, { waitUntil: 'networkidle' })
        const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
        assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=/i.test(viewport))
        const width = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }))
        assert.ok(
          width.scroll <= width.client + 1,
          `${locale}${route}: no page-wide overflow at 320px (${JSON.stringify(width)})`,
        )
      }
    }
  } finally {
    await context.close()
  }

  const blocked = await createContext(browser, { colorScheme: 'dark' })
  try {
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Blocked', 'SecurityError')
        },
      })
    })
    const page = await blocked.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${baseUrl}/en`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    await page.locator('.theme-toggle:visible').click()
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
    await page.locator('.quick-links [data-font-morph="resume-title"]').click()
    await page.waitForURL(`${baseUrl}/en/resume`)
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
    assert.deepEqual(errors, [])
  } finally {
    await blocked.close()
  }
  console.log('Browser color preferences, blocked storage and zoom/reflow checks passed.')
}
