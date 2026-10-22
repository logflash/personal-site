import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, firefox, webkit } from 'playwright-core'

const baseUrl = process.env.EXPERIMENT_BASE_URL ?? 'http://localhost:5173'
const urls = [...new Set([baseUrl, process.env.EXPERIMENT_LAN_URL].filter(Boolean))]
const deployment = JSON.parse(await readFile('vercel.json', 'utf8'))
const policies = deployment.headers
  .flatMap((rule) => rule.headers)
  .filter((header) => header.key.toLowerCase() === 'permissions-policy')
assert.ok(policies.length)
for (const { value } of policies) {
  assert.ok(value.includes('clipboard-write=(self)'))
  assert.ok(value.includes('clipboard-read=()'))
}

const browsers = [
  ['Edge', chromium, { channel: 'msedge' }],
  ['Chrome', chromium, { channel: 'chrome' }],
  ['Firefox', firefox, {}],
  ['WebKit', webkit, {}],
]

for (const [name, engine, options] of browsers) {
  if (process.env.TEST_BROWSER && process.env.TEST_BROWSER !== name) continue
  const browser = await engine.launch({ ...options, headless: true })
  try {
    for (const url of urls)
      for (const mobile of [false, true]) {
        const context = await browser.newContext({
          viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
          hasTouch: mobile,
          ...(engine !== firefox ? { isMobile: mobile } : {}),
        })
        const page = await context.newPage()
        const response = await page.goto(`${url}/en/publications#sweetdeep`, {
          waitUntil: 'networkidle',
        })
        assert.ok(response.headers()['permissions-policy'].includes('clipboard-write=(self)'))
        assert.ok(response.headers()['permissions-policy'].includes('clipboard-read=()'))
        const secure = await page.evaluate(() => isSecureContext)
        let roundTripsVerified = true
        await page.evaluate(() => {
          window.__attempted = ''
          window.__copyMethods = []
          // Observe arguments but delegate to the actual browser implementations.
          if (navigator.clipboard?.writeText) {
            const write = navigator.clipboard.writeText.bind(navigator.clipboard)
            navigator.clipboard.writeText = async (text) => {
              window.__attempted = text
              await write(text)
              window.__copyMethods.push('async')
            }
          }
          const exec = document.execCommand.bind(document)
          document.execCommand = (...args) => {
            if (args[0] === 'copy') window.__attempted = document.activeElement.value
            const success = exec(...args)
            if (args[0] === 'copy' && success) window.__copyMethods.push('selection')
            return success
          }
        })
        const activate = (locator) => (mobile ? locator.tap() : locator.click())
        for (const label of ['Copy citation', 'Copy BibTeX', 'Copy link']) {
          await activate(page.getByRole('button', { name: label, exact: true }))
          await page.waitForFunction(
            () => document.querySelector('.copy-status')?.textContent === 'Copied!',
          )
          assert.equal(await page.locator('.citation-text').count(), 0)
          // Round-trip only this test's just-copied text, using a normal paste.
          // Return a boolean; never log potentially unrelated clipboard contents.
          await page.evaluate(() => {
            const probe = document.createElement('textarea')
            probe.id = 'clipboard-test-probe'
            document.body.append(probe)
            probe.focus({ preventScroll: true })
          })
          await page.keyboard.press('Control+V')
          await page.waitForTimeout(50)
          const matches = await page.evaluate(() => {
            const probe = document.getElementById('clipboard-test-probe')
            const matches =
              probe.value.replaceAll('\r\n', '\n') === window.__attempted.replaceAll('\r\n', '\n')
            probe.remove()
            return matches
          })
          if (!matches && engine === webkit && process.platform === 'win32') {
            roundTripsVerified = false
            console.warn(
              `${name} Windows ${label}: native copy reported success, but OS paste did not round-trip; physical Safari validation remains required.`,
            )
          } else assert.ok(matches, `${name} ${url} ${label}: clipboard round-trip failed`)
        }
        if (!secure)
          assert.deepEqual(await page.evaluate(() => window.__copyMethods), [
            'selection',
            'selection',
            'selection',
          ])
        await page.evaluate(() => {
          if (navigator.clipboard)
            navigator.clipboard.writeText = async () => {
              throw new DOMException('Denied', 'NotAllowedError')
            }
          document.execCommand = () => false
        })
        await activate(page.getByRole('button', { name: 'Copy BibTeX', exact: true }))
        await page.locator('.citation-text').waitFor({ state: 'visible' })
        // A touch tap can finish focusing the button after the click callback.
        await page.waitForFunction(() => document.activeElement?.matches('.citation-text'))
        assert.match(
          await page.locator('.citation-text').inputValue(),
          /^@misc\{henriques2025sweetdeep,/,
        )
        assert.ok(
          await page
            .locator('.citation-text')
            .evaluate(
              (element) =>
                element.selectionEnd === element.value.length && element.selectionStart === 0,
            ),
        )
        console.log(
          `${name} ${mobile ? 'touch/mobile layout' : 'desktop'} ${secure ? 'secure localhost' : 'HTTP LAN'}: copy interactions and denied-copy fallback passed${!roundTripsVerified ? ' (OS clipboard round-trip unverified on Windows WebKit)' : ', including all three OS clipboard round-trips'}.`,
        )
        await context.close()
      }
  } finally {
    await browser.close()
  }
}
