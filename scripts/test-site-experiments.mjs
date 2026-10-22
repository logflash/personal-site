import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'

const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5174'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []

async function settled(page) {
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-font-morph-active'))
  await page.evaluate(() => document.fonts.ready)
}

async function accessible(page, label) {
  await settled(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  assert.deepEqual(
    results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    [],
    label,
  )
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${label}: horizontal overflow`,
  )
}

try {
  for (const locale of process.argv.includes('--replay-only') ? [] : ['en', 'es', 'ja']) {
    for (const width of [1440, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: width === 320 ? 'reduce' : 'no-preference',
      })
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__copied = text
            },
          },
        })
        window.__morphs = []
        addEventListener('font-morph:record', (event) => window.__morphs.push(event.detail))
      })
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${baseUrl}/${locale}/projects`, { waitUntil: 'networkidle' })
      const filters = page.locator('.project-filters button')
      for (const [index, count] of [8, 4, 5, 3].entries()) {
        await filters.nth(index).click()
        assert.equal(await page.locator('.project:visible').count(), count)
        assert.equal(await filters.nth(index).getAttribute('aria-pressed'), 'true')
        assert.match(await page.locator('.project-count').innerText(), new RegExp(`${count} / 8`))
        for (const group of await page.locator('.project-group:visible').all())
          assert.ok(await group.locator('.project:visible').count())
      }
      await filters.first().focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('.project:visible').count(), 8)
      await accessible(page, `${locale} ${width} projects`)
      if (locale === 'en' && width === 1440)
        await page.screenshot({ path: '.gt-experiment-projects.png', fullPage: true })

      await page.goto(`${baseUrl}/${locale}/publications#sweetdeep`, { waitUntil: 'networkidle' })
      assert.equal(await page.locator('#sweetdeep').getAttribute('open'), '')
      const buttons = page.locator('.publication-actions button')
      await buttons.nth(0).click()
      assert.match(await page.evaluate(() => window.__copied), /Henriques, I\..+Jha, N\. K\./)
      assert.match(
        await page.evaluate(() => window.__copied),
        /https:\/\/doi.org\/10.48550\/arXiv.2512.03471/,
      )
      await buttons.nth(1).click()
      const bibtex = await page.evaluate(() => window.__copied)
      assert.match(bibtex, /^@misc\{henriques2025sweetdeep,/)
      assert.match(bibtex, /archivePrefix = \{arXiv\}/)
      assert.equal(bibtex.match(/ and /g).length, 13)
      assert.equal(await page.locator('.citation-text').count(), 0)
      await buttons.nth(2).click()
      assert.equal(
        await page.evaluate(() => window.__copied),
        `${baseUrl}/${locale}/publications#sweetdeep`,
      )
      await page.evaluate(() => {
        document.execCommand = () => false
        navigator.clipboard.writeText = async () => {
          throw new Error('Permission denied')
        }
      })
      await buttons.nth(1).click()
      await page.waitForFunction(() => document.activeElement?.matches('.citation-text'))
      assert.equal(
        await page.locator('.citation-text').evaluate((el) => el.selectionEnd - el.selectionStart),
        bibtex.length,
      )
      await accessible(page, `${locale} ${width} citation`)
      if (locale === 'en' && width === 1440)
        await page.screenshot({ path: '.gt-experiment-citation.png', fullPage: true })

      await page.goto(`${baseUrl}/${locale}`, { waitUntil: 'networkidle' })
      await page.locator('.colophon > summary').click()
      const specimen = page.locator('.type-specimen')
      await specimen.click()
      await settled(page)
      assert.equal(await page.locator('.specimen-serif').count(), 1)
      await specimen.click()
      await settled(page)
      assert.equal(await page.locator('.specimen-sans').count(), 1)
      if (width === 1440) {
        const morphs = await page.evaluate(() => window.__morphs)
        assert.equal(morphs.length, 2, 'the specimen must perform real Glyphflux morphs')
        assert.ok(
          morphs.every(
            (morph) =>
              morph.key === 'colophon-specimen' &&
              morph.source.translationHash &&
              morph.target.translationHash,
          ),
        )
      }
      await accessible(page, `${locale} ${width} colophon light`)
      await page.locator('.theme-toggle:visible').click()
      await page.waitForTimeout(300)
      await accessible(page, `${locale} ${width} colophon dark`)
      if (width === 320 && locale === 'ja')
        await page.screenshot({ path: '.gt-experiment-japanese-mobile.png', fullPage: true })
      console.log(
        `Passed ${locale} at ${width}px: filters, citations, clipboard fallback, deep link, type specimen, accessibility, themes.`,
      )
      await context.close()
    }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${baseUrl}/en`, { waitUntil: 'networkidle' })
  await page.locator('.colophon > summary').click()
  await page.locator('.colophon-record').click()
  const stop = page.getByRole('button', { name: 'Stop recording', exact: true })
  await stop.waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.type-specimen').click()
  await settled(page)
  await page.waitForTimeout(300)
  await page.locator('.type-specimen').click()
  await settled(page)
  await page.locator('.quick-links [data-font-morph="projects-title"]').click()
  await page.waitForURL(`${baseUrl}/en/projects`)
  await settled(page)
  await page.locator('.project-filters button').nth(3).click()
  await page.waitForTimeout(400)
  await stop.click()
  await page.locator('.replay-overlay-box #stage').waitFor({ state: 'visible', timeout: 45000 })
  const downloadStarted = page.waitForEvent('download')
  await page.locator('#downloadJson').click()
  const download = await downloadStarted
  const bundle = JSON.parse(await readFile(await download.path(), 'utf8'))
  await writeFile('.gt-experiment-recording.json', JSON.stringify(bundle))
  assert.equal(
    bundle.events.filter(
      (event) =>
        event.type === 5 &&
        event.data?.tag === 'font-morph' &&
        event.data.payload?.key === 'colophon-specimen',
    ).length,
    2,
  )
  const track = page.locator('#track')
  const scrub = async (fraction) => {
    await track.evaluate((element, position) => {
      for (const type of ['pointerdown', 'pointerup']) {
        const box = element.getBoundingClientRect()
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: 'mouse',
            clientX: position === 0 ? box.left - 1 : box.right + 1,
            clientY: box.top + box.height / 2,
            buttons: type === 'pointerdown' ? 1 : 0,
          }),
        )
      }
    }, fraction)
    await page.waitForTimeout(350)
  }
  const frame = page.frameLocator('#player iframe')
  for (const [locale, title] of [
    ['en', 'About this site'],
    ['es', 'Acerca de este sitio'],
    ['ja', 'このサイトについて'],
  ]) {
    await page.locator(`#flags button[data-loc="${locale}"]`).click()
    await scrub(0)
    assert.equal(await frame.locator('.colophon > summary').innerText(), title)
    await page.locator('#playBtn').click()
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('#director canvas[data-font-morph-renderer="sdf"]')
        if (!canvas?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        return pixels?.some((value, index) => index % 4 === 3 && value > 0)
      },
      null,
      { timeout: 30000 },
    )
    await page.locator('#playBtn').click()
    await scrub(1)
    assert.equal(await frame.locator('.project:visible').count(), 3)
    assert.equal(
      await frame.locator('.project-filters button').nth(3).getAttribute('aria-pressed'),
      'true',
    )
    console.log(
      `Passed ${locale} recording: translated colophon, painted Glyphflux replay, project filter state, seeking.`,
    )
  }
  await page.locator('.replay-close').focus()
  await page.keyboard.press('Escape')
  await page.locator('.replay-overlay').waitFor({ state: 'hidden' })
  await context.close()
  assert.deepEqual(errors, [], 'browser errors')
} finally {
  await browser.close()
}
