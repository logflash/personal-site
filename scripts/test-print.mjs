import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const channel = process.env.TEST_BROWSER ?? 'chrome'
const output = '.gt-print'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
const errors = []
try {
  for (const locale of ['en', 'es', 'ja']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/${locale}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    // They remain available to keyboard users on screen, including after
    // returning from print preview while the recording controls have focus.
    const control = page.locator('.sidebar .identity-tools button').first()
    await control.focus()
    assert.ok(await control.isVisible())
    await page.emulateMedia({ media: 'print' })
    for (const width of [1440, 780]) {
      await page.setViewportSize({ width, height: 1000 })
      const helpers = await page.locator('.skip-link, .identity-tools').evaluateAll((elements) =>
        elements.map((element) => ({
          display: getComputedStyle(element).display,
          boxes: element.getClientRects().length,
        })),
      )
      assert.ok(helpers.length >= 2)
      assert.equal(
        await page.locator('.pill-nav').isVisible(),
        false,
        'homepage navbar is hidden in print',
      )
      assert.ok(
        helpers.every(({ display, boxes }) => display === 'none' && boxes === 0),
        `${locale} ${width}: no printable helper boxes`,
      )
      const padding = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('main'))
        return {
          top: parseFloat(style.paddingTop),
          bottom: parseFloat(style.paddingBottom),
          repeat: style.boxDecorationBreak,
        }
      })
      assert.ok(padding.top >= 45 && padding.bottom >= 45, '12mm built-in vertical print padding')
      assert.equal(padding.repeat, 'clone', 'padding repeats across page breaks')
      assert.equal(
        await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).display),
        'none',
        'no sidebar column in print',
      )
      const edges = await page.locator('main').evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        const left = rect.left + parseFloat(style.paddingLeft)
        const right = innerWidth - rect.right + parseFloat(style.paddingRight)
        return { left, right, width: innerWidth - left - right }
      })
      assert.ok(edges.left >= 45 && Math.abs(edges.left - edges.right) < 1, 'equal print margins')
      for (const element of await page
        .locator('.mobile-top, .contact, .colophon, .copyright-mobile')
        .all()) {
        const rect = await element.boundingBox()
        assert.ok(
          Math.abs(rect.x) < 1 && Math.abs(rect.width - width) < 1,
          'header and dividers span page width',
        )
      }
      assert.equal(
        await page
          .locator('.copyright-mobile')
          .evaluate((el) => getComputedStyle(el).borderTopWidth),
        '1px',
        'copyright has a printed divider at every viewport width',
      )
      for (const section of await page
        .locator('main > .section:not(.contact), main > .quick-links')
        .all()) {
        const rect = await section.boundingBox()
        assert.ok(Math.abs(rect.width - edges.width) < 1, 'content fills printable width')
      }
    }
    for (const scale of [0.5, 0.75, 0.8, 0.9, 1, 1.25, 1.5, 2]) {
      await page.pdf({
        path: `${output}/${channel}-${locale}-${scale}.pdf`,
        format: 'Letter',
        scale,
        printBackground: true,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
      })
    }
    await page.pdf({
      path: `${output}/${channel}-${locale}-a4.pdf`,
      format: 'A4',
      scale: 1,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    await page.emulateMedia({ media: 'screen' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await control.focus()
    assert.ok(await control.isVisible(), 'recording controls still work after print')
    await page.locator('.skip-link').focus()
    assert.ok(await page.locator('.skip-link').isVisible(), 'skip link remains keyboard accessible')
    assert.equal(
      await page.locator('main').evaluate((el) => getComputedStyle(el).paddingTop),
      '84px',
      'print padding does not affect the screen',
    )
    assert.equal(
      await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).position),
      'fixed',
      'screen sidebar stays fixed',
    )

    // A long document exercises repeated padding on continuation pages, not
    // just the beginning and end of a short homepage.
    await page.goto(`${base}/${locale}/resume`, { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      await document.fonts.ready
      // Deliberately mix open and closed entries: print must reveal both,
      // without replacing their remembered screen state.
      const entries = document.querySelectorAll('details.resume-entry')
      entries.forEach((entry, index) => {
        entry.open = index === 0
      })
    })
    const disclosureState = await page
      .locator('details.resume-entry')
      .evaluateAll((entries) => entries.map((entry) => entry.open))
    await page.emulateMedia({ media: 'print' })
    assert.equal(
      await page.locator('.resume-copy > .section > .h-row h3').count(),
      3,
      'Education, Experience and Skills are h3 headings',
    )
    const headingStyle = await page
      .locator('.resume-copy .h-row h3')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el)
        return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight }
      })
    assert.ok(
      headingStyle.family.includes('IBM Plex Sans'),
      'resume sections use the Projects sans serif style',
    )
    assert.equal(headingStyle.size, '16px')
    assert.equal(headingStyle.weight, '600')
    for (const details of await page
      .locator('.resume-entry-details, .resume-skill-card-content')
      .all()) {
      assert.ok(await details.isVisible(), 'every resume box is expanded for print')
      assert.ok((await details.boundingBox()).height > 0, 'printed box has content height')
    }
    assert.equal(
      await page.locator('.resume-copy > .stack > .pub').isVisible(),
      false,
      'PDF download is hidden in print',
    )
    assert.equal(
      await page.locator('.pill-nav').isVisible(),
      false,
      'resume navbar is hidden in print',
    )
    assert.ok(await page.locator('.mobile-header').isVisible(), 'identity remains in print')
    assert.ok(
      await page.locator('.print-contact').isVisible(),
      'contact details appear beside identity',
    )
    for (const control of await page
      .locator('.mobile-header .locale-switcher, .mobile-header .theme-toggle')
      .all()) {
      assert.equal(await control.isVisible(), false, 'screen preferences do not print')
    }
    for (const card of await page.locator('.resume-skill-card').all()) {
      assert.equal(
        await card.evaluate((el) => getComputedStyle(el).breakInside),
        'avoid',
        'short skill boxes stay together',
      )
    }
    for (const control of await page
      .locator(
        '.resume-page .disclosure-label, .resume-page .disclosure-close, .resume-page .heading-control',
      )
      .all()) {
      assert.equal(
        await control.isVisible(),
        false,
        'interactive resume controls are hidden in print',
      )
    }
    assert.equal(
      await page.locator('.resume-copy').evaluate((el) => getComputedStyle(el).maxWidth),
      'none',
      'long resume uses full print width',
    )
    for (const format of ['Letter', 'A4']) {
      for (const scale of [0.75, 1, 1.25]) {
        await page.pdf({
          path: `${output}/${channel}-${locale}-resume-${format}-${scale}.pdf`,
          format,
          scale,
          printBackground: true,
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        })
      }
    }
    await page.emulateMedia({ media: 'screen' })
    assert.deepEqual(
      await page
        .locator('details.resume-entry')
        .evaluateAll((entries) => entries.map((entry) => entry.open)),
      disclosureState,
      'printing preserves disclosure state',
    )
    for (const content of await page
      .locator('.resume-skill-card:not([data-open]) .resume-skill-card-content')
      .all()) {
      assert.equal(await content.isVisible(), false, 'closed skill boxes stay closed on screen')
    }
    assert.ok(
      await page.locator('.resume-copy > .stack > .pub').isVisible(),
      'PDF download returns on screen',
    )
    await page.setViewportSize({ width: 780, height: 1000 })
    assert.equal(
      await page.locator('.print-contact').isVisible(),
      false,
      'print contacts stay off screen',
    )
    assert.ok(await page.locator('.mobile-header .locale-switcher').isVisible())
    assert.ok(await page.locator('.mobile-header .theme-toggle').isVisible())
    assert.ok(await page.locator('.pill-nav').isVisible(), 'mobile resume navbar returns on screen')
    console.log(
      `Passed ${channel} ${locale}: zero-margin Letter/A4 output, scales 50–200%, expanded resume, keyboard controls after print`,
    )
    await page.close()
  }
  assert.deepEqual(errors, [], 'browser errors')
} finally {
  await browser.close()
}
