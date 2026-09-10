import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBrowser } from '../e2e/browser.mjs'

const outputRoot = fileURLToPath(new URL('../demo-dist', import.meta.url))
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const file = resolve(outputRoot, relative)
    if (!file.startsWith(outputRoot) || !(await stat(file)).isFile()) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(await readFile(file))
  } catch {
    response.writeHead(404).end('Not found')
  }
})

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const address = server.address()
assert(address && typeof address !== 'string')

const errors = []
const { browser, close } = await getBrowser()
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 720 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' })

  const setProgress = async (value) => {
    await page.locator('#progress').evaluate((element, next) => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(element, String(next))
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await page.waitForFunction(
      (expected) => document.querySelector('output')?.textContent === `${expected}%`,
      value / 10,
    )
  }

  const frame = () =>
    page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON()
      const liveInk = (selector) => {
        const element = document.querySelector(selector)
        const context = document.createElement('canvas').getContext('2d')
        if (!element || !context) return null
        const style = getComputedStyle(element)
        context.font = style.font
        context.direction = style.direction
        const metrics = context.measureText(element.textContent ?? '')
        const range = document.createRange()
        range.selectNodeContents(element)
        const elementRect = element.getBoundingClientRect()
        const rangeRect = range.getBoundingClientRect()
        const baseline = rangeRect.top - elementRect.top + metrics.fontBoundingBoxAscent
        return {
          top: elementRect.top + baseline - metrics.actualBoundingBoxAscent,
          bottom: elementRect.top + baseline + metrics.actualBoundingBoxDescent,
        }
      }
      const layerElement = document.querySelector('[data-font-morph-progress]')
      const layerRect = layerElement?.getBoundingClientRect()
      const pathBoxes = [...(layerElement?.querySelectorAll('path') ?? [])].map((path) =>
        path.getBBox(),
      )
      const pathTop = Math.min(...pathBoxes.map((box) => box.y))
      const pathBottom = Math.max(...pathBoxes.map((box) => box.y + box.height))
      return {
        source: rect('[data-demo-endpoint="source"]'),
        target: rect('[data-demo-endpoint="target"]'),
        layer: rect('[data-font-morph-progress]'),
        sourceInk: liveInk('[data-demo-endpoint="source"]'),
        targetInk: liveInk('[data-demo-endpoint="target"]'),
        layerInk:
          layerRect && pathBoxes.length
            ? {
                top: layerRect.top + (pathTop / 1000) * layerRect.height,
                bottom: layerRect.top + (pathBottom / 1000) * layerRect.height,
              }
            : null,
        sourceOpacity: getComputedStyle(
          document.querySelector('[data-demo-endpoint="source"]'),
        ).opacity,
        targetOpacity: getComputedStyle(
          document.querySelector('[data-demo-endpoint="target"]'),
        ).opacity,
        layerOpacity: getComputedStyle(
          document.querySelector('[data-font-morph-progress]'),
        ).opacity,
        sourceRole: document.querySelector('[data-font-morph-progress]')?.getAttribute(
          'data-font-morph-source-role',
        ),
        targetRole: document.querySelector('[data-font-morph-progress]')?.getAttribute(
          'data-font-morph-target-role',
        ),
        firstGlyphCutouts: [...(layerElement?.querySelectorAll('path[fill="black"]') ?? [])]
          .map((path) => path.getBBox())
          .filter((box) => box.x < 200 && box.width > 1 && box.height > 1).length,
        paths: document.querySelectorAll('[data-font-morph-progress] path').length,
      }
    })

  const closeEnough = (actual, expected) =>
    ['left', 'top', 'width', 'height'].every(
      (key) => Math.abs(actual[key] - expected[key]) <= 0.5,
    )
  const verticalCenter = (rect) => rect.top + rect.height / 2
  const verticallyAligned = (actual, expected) =>
    // Canvas ink metrics are whole-pixel bounds while the sampled SVG curve
    // can retain subpixel extrema (most visibly on accented capitals).
    Math.abs(actual.top - expected.top) <= 2 &&
    Math.abs(actual.bottom - expected.bottom) <= 1.25

  const expectedText = {
    en: 'Resume',
    es: 'Currículum',
    ja: '履歴書',
  }
  const expectedCaptions = {
    en: ['Sans serif', 'Serif'],
    es: ['Sans serif', 'Serif'],
    ja: ['Gothic', 'Mincho'],
  }

  for (const [locale, text] of Object.entries(expectedText)) {
    if (locale !== 'en') await page.locator('#locale').selectOption(locale)
    try {
      await page.waitForFunction(
        ([expectedLocale, expected]) =>
          document.querySelector('[data-demo-endpoint="source"]')?.getAttribute('lang') ===
            expectedLocale &&
          document.querySelector('[data-demo-endpoint="source"]')?.textContent === expected &&
          document.querySelector('main')?.dataset.demoStatus === 'ready',
        [locale, text],
        { timeout: 30_000 },
      )
    } catch (error) {
      const state = await page.evaluate(() => ({
        locale: document.querySelector('[data-demo-endpoint="source"]')?.getAttribute('lang'),
        text: document.querySelector('[data-demo-endpoint="source"]')?.textContent,
        status: document.querySelector('main')?.dataset.demoStatus,
        message: document.querySelector('.status')?.textContent,
      }))
      throw new Error(`${locale}: demo did not become ready: ${JSON.stringify(state)}`, {
        cause: error,
      })
    }

    await setProgress(0)
    const left = await frame()
    assert(left.layer && left.source)
    assert(
      closeEnough(left.layer, left.source),
      `${locale}: progress 0 must overlap the source box exactly`,
    )
    assert.equal(left.sourceRole, 'sans')
    assert.equal(left.targetRole, 'serif')
    assert.deepEqual(
      await page.locator('.endpoint-caption').allTextContents(),
      expectedCaptions[locale],
    )
    assert.equal(left.sourceOpacity, '0.16')
    assert.equal(left.targetOpacity, '0.16')
    assert.equal(left.layerOpacity, '1')
    assert(Math.abs(verticalCenter(left.source) - verticalCenter(left.target)) <= 0.5)
    assert(left.layerInk && left.sourceInk)
    assert(
      verticallyAligned(left.layerInk, left.sourceInk),
      `${locale}: the source outline must share the live sans-serif baseline`,
    )

    await setProgress(500)
    const middle = await frame()
    assert(middle.layer && middle.source && middle.target)
    const expectedMiddle = {
      left: (middle.source.left + middle.target.left) / 2,
      top: (middle.source.top + middle.target.top) / 2,
      width: (middle.source.width + middle.target.width) / 2,
      height: (middle.source.height + middle.target.height) / 2,
    }
    assert(
      closeEnough(middle.layer, expectedMiddle),
      `${locale}: progress 0.5 must use the midpoint box`,
    )
    assert.equal(middle.sourceOpacity, '0.16')
    assert.equal(middle.targetOpacity, '0.16')
    assert.equal(middle.layerOpacity, '1')

    await setProgress(990)
    const almostRight = await frame()
    assert(almostRight.layer && almostRight.target)
    assert(
      Math.abs(verticalCenter(almostRight.layer) - verticalCenter(almostRight.target)) <= 0.5,
      `${locale}: progress 0.99 must remain vertically centered on the target`,
    )
    assert(
      Math.abs(almostRight.layer.left - almostRight.target.left) > 1,
      `${locale}: progress 0.99 must retain its horizontal interpolation`,
    )
    assert.equal(almostRight.sourceOpacity, '0.16')
    assert.equal(almostRight.targetOpacity, '0.16')
    assert.equal(almostRight.layerOpacity, '1')

    await setProgress(1000)
    const right = await frame()
    assert(right.layer && right.target)
    assert(
      closeEnough(right.layer, right.target),
      `${locale}: progress 1 must overlap the target box exactly`,
    )
    assert.equal(right.sourceOpacity, '0.16')
    assert.equal(right.targetOpacity, '0.16')
    assert.equal(right.layerOpacity, '1')
    assert(right.layerInk && right.targetInk)
    assert(
      verticallyAligned(right.layerInk, right.targetInk),
      `${locale}: the target outline must share the live serif baseline`,
    )
    if (locale === 'en') {
      assert.equal(
        right.firstGlyphCutouts,
        0,
        'the target R must not subtract its overlapping upper-left serif',
      )
    }
    assert(left.paths > 0 && middle.paths === left.paths && right.paths === left.paths)
  }

  await setProgress(500)

  const presentation = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    sourceOpacity: getComputedStyle(
      document.querySelector('[data-demo-endpoint="source"]'),
    ).opacity,
    targetOpacity: getComputedStyle(
      document.querySelector('[data-demo-endpoint="target"]'),
    ).opacity,
    locales: document.querySelectorAll('#locale option').length,
  }))
  assert.equal(presentation.background, 'rgb(255, 255, 255)')
  assert.equal(presentation.sourceOpacity, '0.16')
  assert.equal(presentation.targetOpacity, '0.16')
  assert.equal(presentation.locales, 3)

  await page.goto(`http://127.0.0.1:${address.port}/?renderer=sdf`, {
    waitUntil: 'networkidle',
  })
  await page.waitForSelector('[data-demo-status="ready"]')
  await page.evaluate(() => document.fonts.ready)
  const setSdfProgress = async (locale, value) => {
    const requestedProgress = value / 1000
    const expectedPrefix = `${locale}:${requestedProgress}:`
    const currentValue = Number(await page.locator('#progress').inputValue())
    if (currentValue === value) {
      const nudge = value === 1000 ? 990 : value + 10
      const previousFrame = await page.locator('[data-font-morph-sdf]').getAttribute(
        'data-font-morph-sdf-frame',
      )
      await setProgress(nudge)
      await page.waitForFunction(
        ([expectedLocale, expectedProgress, previous]) => {
          const frame = document.querySelector('[data-font-morph-sdf]')?.dataset.fontMorphSdfFrame
          return frame?.startsWith(`${expectedLocale}:${expectedProgress}:`) && frame !== previous
        },
        [locale, nudge / 1000, previousFrame],
      )
    }
    const previousFrame = await page.locator('[data-font-morph-sdf]').getAttribute(
      'data-font-morph-sdf-frame',
    )
    await setProgress(value)
    await page.waitForFunction(
      ([prefix, previous]) => {
        const frame = document.querySelector('[data-font-morph-sdf]')?.dataset.fontMorphSdfFrame
        return frame?.startsWith(prefix) && frame !== previous
      },
      [expectedPrefix, previousFrame],
    )
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ))
    await page.evaluate(async () => {
      let previous = ''
      let stableFrames = 0
      while (stableFrames < 4) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = document.querySelector('[data-font-morph-sdf]')?.dataset.fontMorphSdfFrame ?? ''
        stableFrames = current === previous ? stableFrames + 1 : 0
        previous = current
      }
    })
  }

  for (const [locale, expected] of Object.entries(expectedText)) {
    await page.locator('#locale').selectOption(locale)
    await page.waitForFunction(
      ([expectedLocale, expectedText]) =>
        document.querySelector('[data-demo-endpoint="source"]')?.getAttribute('lang') ===
          expectedLocale &&
        document.querySelector('[data-demo-endpoint="source"]')?.textContent === expectedText,
      [locale, expected],
    )

    const canvasFrame = () => page.evaluate(async () => {
      const canvas = document.querySelector('[data-font-morph-sdf]')
      const context = canvas.getContext('2d')
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
      const alpha = Uint8Array.from(
        { length: rgba.length / 4 },
        (_, index) => rgba[index * 4 + 3],
      )
      const digest = await crypto.subtle.digest('SHA-256', alpha)
      return {
        frame: [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join(''),
        inkPixels: alpha.filter(Boolean).length,
        width: canvas.width,
        height: canvas.height,
        marker: canvas.dataset.fontMorphSdfFrame,
        stage: document.querySelector('.stage')?.getBoundingClientRect().toJSON(),
        source: document.querySelector('[data-demo-endpoint="source"]')?.getBoundingClientRect().toJSON(),
        target: document.querySelector('[data-demo-endpoint="target"]')?.getBoundingClientRect().toJSON(),
        sourceOpacity: getComputedStyle(
          document.querySelector('[data-demo-endpoint="source"]'),
        ).opacity,
        targetOpacity: getComputedStyle(
          document.querySelector('[data-demo-endpoint="target"]'),
        ).opacity,
      }
    })

    await setSdfProgress(locale, 0)
    const sourceFrame = await canvasFrame()
    await setSdfProgress(locale, 500)
    const middleFrame = await canvasFrame()
    await setSdfProgress(locale, 1000)
    const targetFrame = await canvasFrame()
    await setSdfProgress(locale, 0)
    const rewoundSourceFrame = await canvasFrame()

    assert(sourceFrame.inkPixels > 0, `${locale}: the source distance-field frame must render ink`)
    assert(middleFrame.inkPixels > 0, `${locale}: the intermediate distance-field frame must render ink`)
    assert(targetFrame.inkPixels > 0, `${locale}: the target distance-field frame must render ink`)
    assert.notEqual(sourceFrame.frame, middleFrame.frame)
    assert.notEqual(middleFrame.frame, targetFrame.frame)
    assert.equal(
      sourceFrame.frame,
      rewoundSourceFrame.frame,
      `${locale}: rewinding must reconstruct the same source pixels without hysteresis\n${JSON.stringify({ sourceFrame, rewoundSourceFrame }, null, 2)}`,
    )
    assert.equal(sourceFrame.sourceOpacity, '0.16')
    assert.equal(sourceFrame.targetOpacity, '0.16')
  }

  assert.deepEqual(errors, [])

  console.log('font-morph React demo checks passed for KUTE and SDF in en, es, and ja')
  await context.close()
} finally {
  await close()
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
}
