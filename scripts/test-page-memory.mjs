import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({
  channel: process.env.TEST_BROWSER ?? 'chrome',
  headless: true,
})
const errors = []
async function settled(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-font-morph-active'))
  await page.waitForTimeout(100)
}
async function navigate(page, path) {
  // Exercise the site's actual links without Playwright scrolling a mobile
  // navigation control into view and changing the position being tested.
  await page
    .locator(`a[href="${path}"]:visible`)
    .first()
    .evaluate((link) => link.click())
  await page.waitForURL(`${base}${path}`)
  await settled(page)
}
async function readAt(page, selector) {
  await page.locator(selector).evaluate((element) => {
    scrollTo({ top: scrollY + element.getBoundingClientRect().top - 80, behavior: 'instant' })
  })
  await page.waitForTimeout(120)
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().top)
}

try {
  for (const width of process.argv.includes('--edges-only') ? [] : [1440, 390]) {
    for (const locale of ['en', 'es', 'ja']) {
      const context = await browser.newContext({ viewport: { width, height: 850 } })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/${locale}`)
      await settled(page)
      await navigate(page, `/${locale}/resume`)
      await page.locator('#education .resume-entry').nth(1).locator('summary').click()
      await page.locator('#education .resume-entry').nth(2).locator('summary').click()
      const readEducation = '[data-reading-anchor^="resume:Princeton University:Sep 2021"]'
      await readAt(page, readEducation)
      const snapshot = () =>
        page.evaluate(() => ({
          key: history.state?.__TSR_key,
          y: scrollY,
          boxes: [...document.querySelectorAll('.resume-entry')].map((el) => el.open),
          skills: [...document.querySelectorAll('.resume-skill-card-toggle')].map((el) =>
            el.getAttribute('aria-expanded'),
          ),
        }))
      const education = await snapshot()
      // Desktop uses a real sidebar click; mobile uses the same href without
      // first scrolling its non-sticky navigation into view.
      const link = page.locator('nav a[href$="#experience"]:visible').first()
      if (width === 1440) await link.click()
      else await link.evaluate((el) => el.click())
      await page.waitForURL(`${base}/${locale}/resume#experience`)
      await settled(page)
      const experienceKey = (await snapshot()).key
      assert.equal(await page.locator('html').getAttribute('data-active-section'), 'experience')
      if (width === 1440) {
        assert.equal(
          await page.locator('.side-nav a[aria-current="page"]').count(),
          1,
          'only the selected section is current',
        )
      }
      assert.ok(
        experienceKey && experienceKey !== education.key,
        'hash navigation has its own persistent history key',
      )
      await page.locator('#experience .resume-entry').nth(0).locator('summary').click()
      await page.locator('#experience .resume-entry').nth(1).locator('summary').click()
      await page
        .locator('#experience .resume-entry')
        .nth(1)
        .evaluate((el) => {
          scrollTo({ top: scrollY + el.getBoundingClientRect().top - 120, behavior: 'instant' })
        })
      await page.waitForTimeout(150)
      const experience = await snapshot()
      // Repeated visits must not overwrite either entry's independent state.
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.goBack()
        await settled(page)
        const back = await snapshot()
        assert.equal(await page.locator('html').getAttribute('data-active-section'), 'resume')
        assert.equal(back.key, education.key)
        assert.deepEqual(
          back.boxes,
          education.boxes,
          'hash Back restores education disclosure state',
        )
        assert.ok(
          Math.abs(back.y - education.y) < 4,
          `hash Back restores reading position: ${back.y} vs ${education.y}`,
        )
        await page.goForward()
        await settled(page)
        const forward = await snapshot()
        assert.equal(await page.locator('html').getAttribute('data-active-section'), 'experience')
        assert.equal(forward.key, experience.key)
        assert.deepEqual(
          forward.boxes,
          experience.boxes,
          'hash Forward restores experience disclosure state',
        )
        assert.ok(
          Math.abs(forward.y - experience.y) < 4,
          `hash Forward restores reading position: ${forward.y} vs ${experience.y}`,
        )
      }
      // Heading anchors use the same history-aware navigation as the sidebar.
      await page.locator('#skills .h-link').evaluate((el) => el.click())
      await page.waitForURL(`${base}/${locale}/resume#skills`)
      await settled(page)
      await page.locator('.resume-skill-card-toggle').first().click()
      await settled(page)
      const skills = await snapshot()
      assert.ok(skills.key && skills.key !== experience.key)
      await page.goBack()
      await settled(page)
      assert.deepEqual((await snapshot()).skills, experience.skills)
      await page.goForward()
      await settled(page)
      assert.deepEqual((await snapshot()).skills, skills.skills)
      assert.ok(
        Math.abs((await snapshot()).y - skills.y) < 4,
        'heading anchor restores skill position',
      )
      console.log(
        `Passed ${locale} ${width}px: independent hash history, disclosures, positions, heading anchors, skill cards`,
      )
      await context.close()
    }
  }
  for (const width of process.argv.includes('--edges-only') || process.argv.includes('--hash-only')
    ? []
    : [1440, 390]) {
    for (const locale of ['en', 'es', 'ja']) {
      const context = await browser.newContext({ viewport: { width, height: 850 } })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      console.log(`Testing ${locale} ${width}px`)
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/${locale}/resume`)
      await settled(page)
      console.log('Loaded resume')
      const entries = page.locator('.resume-entry')
      await entries.nth(1).locator('summary').click()
      await entries.nth(2).locator('summary').click()
      await page.locator('.resume-skill-card-toggle').first().click()
      await settled(page)
      const selector = '[data-reading-anchor^="resume:Princeton University:Sep 2021"]'
      const before = await readAt(page, selector)
      await navigate(page, `/${locale}`)
      await page.goBack()
      await settled(page)
      assert.equal(
        await entries.nth(1).evaluate((el) => el.open),
        true,
        'Back restores disclosures',
      )
      assert.equal(await entries.nth(2).evaluate((el) => el.open), true)
      assert.equal(
        await page.locator('.resume-skill-card-toggle').first().getAttribute('aria-expanded'),
        'true',
      )
      assert.ok(
        Math.abs(
          (await page.locator(selector).evaluate((el) => el.getBoundingClientRect().top)) - before,
        ) < 4,
        'Back restores reading position',
      )
      await page.goForward()
      await settled(page)
      await navigate(page, `/${locale}/projects`)
      await page.locator('.project-filters button').nth(2).click()
      await navigate(page, `/${locale}`)
      await page.goBack()
      await settled(page)
      assert.equal(
        await page.locator('.project-filters button').nth(2).getAttribute('aria-pressed'),
        'true',
        'Forward restores filter',
      )
      await navigate(page, `/${locale}`)
      await navigate(page, `/${locale}/resume`)
      assert.equal(
        await entries.nth(1).evaluate((el) => el.open),
        false,
        'ordinary navigation starts fresh',
      )
      assert.equal(await page.evaluate(() => scrollY), 0)
      await entries.nth(2).locator('summary').click()
      await readAt(page, selector)
      const nextLocale = { en: 'es', es: 'ja', ja: 'en' }[locale]
      await page.locator('.locale-switcher:visible').selectOption(nextLocale)
      await page.waitForURL(`${base}/${nextLocale}/resume`)
      await settled(page)
      assert.equal(
        await entries.nth(2).evaluate((el) => el.open),
        true,
        'language preserves disclosure',
      )
      assert.ok(
        Math.abs(
          (await page.locator(selector).evaluate((el) => el.getBoundingClientRect().top)) - 80,
        ) < 4,
        'language preserves semantic reading position',
      )
      await page.reload()
      await settled(page)
      assert.equal(await entries.nth(2).evaluate((el) => el.open), false, 'refresh starts fresh')
      assert.equal(await page.evaluate(() => scrollY), 0)
      await page.goto(`${base}/${locale}/publications#sweetdeep`)
      await settled(page)
      assert.equal(
        await page.locator('#sweetdeep').evaluate((el) => el.open),
        true,
        'explicit deep link expands paper',
      )
      console.log(
        `Passed ${locale} ${width}px: history, filters, disclosures, skills, language position, fresh navigation, refresh, deep link`,
      )
      await context.close()
    }
  }
  if (!process.argv.includes('--hash-only')) {
    const context = await browser.newContext({ viewport: { width: 390, height: 850 } })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/en`)
    await settled(page)
    const graph = page.locator('.cg-scroller')
    assert.equal(await graph.count(), 1, 'contribution graph is available')
    await graph.evaluate((element) => {
      element.scrollLeft = 150
    })
    const graphX = await graph.evaluate((element) => element.scrollLeft)
    await navigate(page, '/en/projects')
    await page.locator('.project-filters button').nth(3).click()
    await page.locator('.locale-switcher:visible').selectOption('ja')
    await page.waitForURL(`${base}/ja/projects`)
    await settled(page)
    assert.equal(
      await page.locator('.project-filters button').nth(3).getAttribute('aria-pressed'),
      'true',
      'language preserves filter',
    )
    await page.goBack()
    await settled(page)
    assert.equal(
      await page.locator('.project-filters button').nth(3).getAttribute('aria-pressed'),
      'true',
      'cross-document Back preserves filter',
    )
    await page.goBack()
    await settled(page)
    assert.ok(
      Math.abs((await graph.evaluate((element) => element.scrollLeft)) - graphX) < 2,
      'Back restores graph horizontal scroll',
    )
    await context.close()
    console.log('Passed mobile graph scroll, translated filter, and cross-document history')

    const blocked = await browser.newContext()
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', {
        get() {
          throw new DOMException('Blocked', 'SecurityError')
        },
      })
    })
    const fallback = await blocked.newPage()
    fallback.setDefaultTimeout(15000)
    fallback.on('pageerror', (error) => errors.push(error.message))
    await fallback.goto(`${base}/en/projects`)
    await settled(fallback)
    await fallback.locator('.project-filters button').nth(1).click()
    await navigate(fallback, '/en')
    await fallback.goBack()
    await settled(fallback)
    assert.equal(
      await fallback.locator('.project-filters button').nth(1).getAttribute('aria-pressed'),
      'true',
      'in-memory fallback when storage is blocked',
    )
    await blocked.close()
    console.log('Passed navigation with sessionStorage blocked')
  }
  assert.deepEqual(errors, [], 'browser errors')
} finally {
  await browser.close()
}
