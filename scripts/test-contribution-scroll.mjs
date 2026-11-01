import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { formatMessage } from '@generaltranslation/format'
import ts from 'typescript'
import { chromium, firefox, webkit } from 'playwright-core'
const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const sessionSource = await readFile(
  new URL('../src/lib/contributionSession.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(sessionSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { encodeContributionSession } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const fixture = Array.from({ length: 365 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 10, 1) + i * 86400000).toISOString().slice(0, 10),
  count: i % 20,
  level: i % 5,
}))
const source =
  '{count, plural, one {# contribution} other {# contributions}} · {date, date, ::MMMMd}'
const catalogs = Object.fromEntries(
  await Promise.all(
    ['en', 'es', 'ja'].map(async (locale) => [
      locale,
      JSON.parse(await readFile(new URL(`../src/_gt/${locale}.json`, import.meta.url), 'utf8')),
    ]),
  ),
)
const summaryHash = Object.entries(catalogs.en).find(([, value]) => value === source)[0]

async function checkLabels(page, locale) {
  const cells = await page.locator('.cg-cell[data-contribution-date]').evaluateAll((nodes) =>
    nodes.map((el) => ({
      date: el.dataset.contributionDate,
      count: Number(el.title.split(' ')[0]),
      label: el.getAttribute('aria-label'),
    })),
  )
  const expected = cells.map(({ date, count }) => {
    const [year, month, day] = date.split('-').map(Number)
    return formatMessage(catalogs[locale][summaryHash], {
      locales: locale,
      variables: { count, date: new Date(year, month - 1, day).getTime() },
    })
  })
  assert.deepEqual(
    cells.map(({ label }) => label),
    expected,
    `${locale}: every accessible label retains the GT formatting`,
  )
  const before = await page.evaluate(() => window.dateFormatConstructions)
  assert.ok(
    before <= 2,
    `${locale}: hydration constructed ${before} date formatters; calendar labels should come from SSR`,
  )
  await page
    .locator('.cg-cell[data-contribution-date]')
    .last()
    .dispatchEvent('pointermove', { pointerType: 'mouse', bubbles: true })
  await page.waitForFunction(
    (label) => document.querySelector('.cg-summary-slot')?.textContent === label,
    expected.at(-1),
  )
  const after = await page.evaluate(() => window.dateFormatConstructions)
  assert.ok(
    // React's development StrictMode may render the active summary twice.
    after - before <= 2,
    `${locale}: hover formatted ${after - before} dates; only its active summary should be formatted`,
  )
}

async function checkReload(page, expected) {
  // Hold the client bundle to prove the server-rendered graph is already in
  // place before hydration, then check every visible frame through hydration.
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const holdScripts = async (route) => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  }
  await page.route('**/*', holdScripts)
  try {
    await page.reload({ waitUntil: 'commit' })
    // WebKit can defer rAF polling while module requests are held open.
    await page.waitForFunction(() => window.graphPaints?.length > 0, undefined, { polling: 50 })
    const beforeHydration = await page.evaluate(() => window.graphPaints)
    assert.ok(
      beforeHydration.every((x) => Math.abs(x - expected) <= 1),
      `first visible frames before hydration: ${beforeHydration}, expected ${expected}`,
    )
  } finally {
    release()
  }
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const paints = await page.evaluate(() => window.graphPaints)
  assert.ok(
    paints.every((x) => Math.abs(x - expected) <= 1),
    `visible frames through hydration: ${paints}, expected ${expected}`,
  )
  await page.unroute('**/*', holdScripts)
}

for (const [name, engine, options] of [
  ['Edge', chromium, { channel: 'msedge' }],
  ['Chrome', chromium, { channel: 'chrome' }],
  ['Firefox', firefox, {}],
  ['WebKit', webkit, {}],
].filter(([name]) => !process.env.TEST_BROWSER || name === process.env.TEST_BROWSER)) {
  const browser = await engine.launch({ ...options, headless: true })
  try {
    for (const blocked of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      })
      // Keep graph regressions independent of the public GitHub mirror's uptime.
      await context.addCookies([
        {
          name: 'contribution-calendar-v1',
          value: encodeContributionSession({
            contributions: fixture,
            total: { lastYear: fixture.reduce((n, day) => n + day.count, 0) },
          }),
          url: baseUrl,
        },
      ])
      await context.addInitScript(() => {
        window.dateFormatConstructions = 0
        const Original = Intl.DateTimeFormat
        Intl.DateTimeFormat = new Proxy(Original, {
          construct(target, args, newTarget) {
            window.dateFormatConstructions++
            return Reflect.construct(target, args, newTarget)
          },
        })
        window.graphPaints = []
        const sample = () => {
          const graph = document.querySelector('.cg-scroller')
          if (
            graph &&
            !document.documentElement.hasAttribute('data-initial-scroll') &&
            graph.scrollWidth > graph.clientWidth &&
            getComputedStyle(graph).visibility === 'visible'
          ) {
            window.graphPaints.push(graph.scrollLeft)
          }
        }
        // Observe the synchronous reveal as well as each rendering frame.
        new MutationObserver(sample).observe(document, {
          attributes: true,
          subtree: true,
          attributeFilter: ['data-initial-scroll'],
        })
        const frame = () => {
          sample()
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
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
      await page.waitForFunction(
        () => document.querySelector('.cg-scroll-hint').hidden,
        undefined,
        { polling: 50 },
      )
      assert.equal(
        await page.locator('.cg-scroll-hint').evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
      await page.locator('.cg-scroller').evaluate((el) => (el.scrollLeft = 0))
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
      if (blocked) {
        await checkReload(page, Math.max(0, initial.max - 96))
        await page.locator('.cg-scroller').evaluate((el) => (el.scrollLeft = el.scrollWidth))
        await page.waitForFunction(
          () => document.querySelector('.cg-scroll-hint').hidden,
          undefined,
          { polling: 50 },
        )
      } else {
        for (const locale of ['en', 'es', 'ja']) {
          await page.goto(`${baseUrl}/${locale}`, { waitUntil: 'networkidle' })
          await checkLabels(page, locale)
          const graph = page.locator('.cg-scroller')
          const max = await graph.evaluate((el) => el.scrollWidth - el.clientWidth)
          for (const position of [0, Math.round(max / 2), max]) {
            await graph.evaluate((el, x) => {
              el.scrollLeft = x
            }, position)
            // No scrollend wait: pagehide must save even an immediate refresh.
            await checkReload(page, position)
          }
          assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.setViewportSize({ width: 320, height: 844 })
      assert.equal(await page.locator('.cg-scroll-hint').isVisible(), false)
      console.log(
        name,
        blocked ? 'blocked storage' : 'normal storage',
        'right edge, stopped animation, backward scroll, resize, pre-hydration reload passed; initial',
        initial,
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
