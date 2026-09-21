import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const port = Number(process.env.SECURITY_TEST_PORT ?? 4327)
const baseUrl = `http://localhost:${port}`
const expectedHeaders = {
  'cache-control': /(?:^|,\s*)private(?:\s*,|$).*no-store|(?:^|,\s*)no-store(?:\s*,|$).*private/i,
  'cross-origin-embedder-policy': /^require-corp$/i,
  'cross-origin-opener-policy': /^same-origin$/i,
  'cross-origin-resource-policy': /^same-origin$/i,
  'origin-agent-cluster': /^\?1$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/i,
  'x-content-type-options': /^nosniff$/i,
  'x-frame-options': /^DENY$/i,
  'x-permitted-cross-domain-policies': /^none$/i,
}

function stopProcess(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill()
}

async function waitForServer(child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited early.\n${output.join('')}`)
    }
    try {
      const response = await fetch(`${baseUrl}/en`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output.join('')}`)
}

async function assertHttpPolicy() {
  const first = await fetch(`${baseUrl}/en`)
  assert.equal(first.status, 200)
  const html = await first.text()

  for (const [name, expected] of Object.entries(expectedHeaders)) {
    assert.match(first.headers.get(name) ?? '', expected, `${name} must be hardened`)
  }

  const permissionsPolicy = first.headers.get('permissions-policy') ?? ''
  for (const feature of ['camera=()', 'clipboard-read=()', 'microphone=()', 'usb=()']) {
    assert.ok(permissionsPolicy.includes(feature), `Permissions-Policy must disable ${feature}`)
  }

  const csp = first.headers.get('content-security-policy') ?? ''
  for (const directive of [
    "default-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "require-trusted-types-for 'script'",
    'trusted-types default',
  ]) {
    assert.ok(csp.includes(directive), `CSP must contain ${directive}`)
  }

  const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
  assert.ok(nonce, 'CSP must contain a per-response nonce')
  assert.ok(
    csp.includes(
      `style-src-elem 'self' 'nonce-${nonce}' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='`,
    ),
    'stylesheet elements must be same-origin, nonced, or the rrweb empty element',
  )
  assert.ok(
    !csp.includes("style-src 'self' 'unsafe-inline'"),
    'unsafe-inline must not apply to stylesheet elements',
  )
  assert.match(
    html,
    new RegExp(`<meta[^>]+property="csp-nonce"[^>]+content="${nonce}"`),
    'the nonce meta tag must match the response policy',
  )
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    assert.match(match[1], new RegExp(`\\bnonce="${nonce}"`), 'every script must carry the nonce')
  }

  const second = await fetch(`${baseUrl}/en`)
  const secondCsp = second.headers.get('content-security-policy') ?? ''
  const secondNonce = secondCsp.match(/'nonce-([^']+)'/)?.[1]
  assert.ok(secondNonce)
  assert.notEqual(secondNonce, nonce, 'CSP nonces must not be reused')
  await second.body?.cancel()

  const crossSite = await fetch(`${baseUrl}/en`, {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid' },
  })
  assert.equal(crossSite.status, 403, 'cross-site mutations must be rejected')

  const oversized = await fetch(`${baseUrl}/en`, {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(1024 * 1024 + 1),
  })
  assert.equal(oversized.status, 413, 'oversized request bodies must be rejected')

  const encoded = await fetch(`${baseUrl}/en`, {
    method: 'POST',
    headers: {
      origin: baseUrl,
      'content-encoding': 'gzip',
      'content-type': 'application/octet-stream',
    },
    body: new Uint8Array([0]),
  })
  assert.equal(encoded.status, 415, 'encoded request bodies must be rejected')

  const unsupported = await fetch(`${baseUrl}/en`, { method: 'PROPFIND' })
  assert.equal(unsupported.status, 405, 'unsupported HTTP methods must be rejected')
  assert.match(unsupported.headers.get('allow') ?? '', /GET/)
}

function observePage(page, problems, externalRequests) {
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => {
    problems.push(
      `request: ${request.url()} (${request.failure()?.errorText ?? 'unknown failure'})`,
    )
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== baseUrl) {
      externalRequests.add(url.origin)
    }
  })
}

async function installViolationObserver(page) {
  await page.addInitScript(() => {
    globalThis.__securityViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__securityViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      })
    })
  })
}

async function pageViolations(page) {
  return page.evaluate(() => globalThis.__securityViolations)
}

async function assertAvatarReady(page, locale, route) {
  const avatars = await page.locator('.avatar').evaluateAll((elements) =>
    elements.map((element) => ({
      tag: element.tagName,
      role: element.getAttribute('role'),
      label: element.getAttribute('aria-label'),
      background: getComputedStyle(element).backgroundImage,
    })),
  )

  assert.equal(avatars.length, 2, `${locale} ${route} must render both responsive identities`)
  for (const avatar of avatars) {
    assert.deepEqual(
      { tag: avatar.tag, role: avatar.role, label: avatar.label },
      { tag: 'SPAN', role: 'img', label: 'Ian Henriques' },
      `${locale} ${route} avatar must preserve image semantics`,
    )
    assert.match(
      avatar.background,
      /^url\(["']?data:image\/webp;base64,/,
      `${locale} ${route} avatar must be available in critical CSS`,
    )
  }

  assert.deepEqual(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('avatar-160.webp'))
        .map((entry) => entry.name),
    ),
    [],
    `${locale} ${route} must not wait for a separate UI-avatar request`,
  )
}

async function assertBrowserPolicy(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const problems = []
  const externalRequests = new Set()
  observePage(page, problems, externalRequests)
  await installViolationObserver(page)

  for (const locale of ['en', 'es', 'ja']) {
    await page.goto(`${baseUrl}/${locale}`, { waitUntil: 'networkidle' })
    assert.equal(await page.evaluate(() => crossOriginIsolated), true)
    assert.equal(await page.locator('html').getAttribute('lang'), locale)
    assert.equal((await page.title()).length > 0, true)
    await assertAvatarReady(page, locale, 'home')

    const transition = page.locator('a[data-font-morph]').first()
    await transition.waitFor({ state: 'visible' })
    await transition.click()
    await page.waitForURL(`${baseUrl}/${locale}/resume`)
    await page.waitForTimeout(900)
    assert.equal((await page.title()).length > 0, true)
    await assertAvatarReady(page, locale, 'resume')

    await page.locator('.resume-home-nav-link').first().click()
    await page.waitForURL(`${baseUrl}/${locale}`)
    await page.waitForTimeout(900)
    assert.deepEqual(await pageViolations(page), [], `${locale} must not violate its CSP`)
  }

  assert.deepEqual([...externalRequests], [], 'the browser must not contact third-party origins')
  assert.deepEqual(problems, [], 'the browser must not report runtime or resource errors')

  const notFoundPage = await context.newPage()
  const notFoundProblems = []
  const notFoundExternalRequests = new Set()
  notFoundPage.on('pageerror', (error) => notFoundProblems.push(`page: ${error.message}`))
  notFoundPage.on('requestfailed', (request) => {
    notFoundProblems.push(
      `request: ${request.url()} (${request.failure()?.errorText ?? 'unknown failure'})`,
    )
  })
  notFoundPage.on('request', (request) => {
    const url = new URL(request.url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== baseUrl) {
      notFoundExternalRequests.add(url.origin)
    }
  })
  await installViolationObserver(notFoundPage)

  const notFoundHeadings = {
    en: 'Sorry, page not found.',
    es: 'Lo siento, página no encontrada.',
    ja: 'すみません。リンク先は利用できません。',
  }
  for (const [locale, heading] of Object.entries(notFoundHeadings)) {
    const response = await notFoundPage.goto(`${baseUrl}/${locale}/missing-page`, {
      waitUntil: 'networkidle',
    })
    assert.equal(response?.status(), 404, `${locale} missing routes must return HTTP 404`)
    assert.equal(await notFoundPage.locator('html').getAttribute('lang'), locale)
    assert.equal(await notFoundPage.locator('.not-found h2').textContent(), heading)
    assert.equal(
      await notFoundPage.locator('head meta[name="robots"]').getAttribute('content'),
      'noindex',
    )
    assert.equal(
      await notFoundPage.locator('.side-nav a[data-section="about"]').getAttribute('href'),
      `/${locale}#about`,
      `${locale} 404 navigation must return to a real homepage section`,
    )
    assert.deepEqual(
      await pageViolations(notFoundPage),
      [],
      `${locale} 404 must not violate its CSP`,
    )
    await notFoundPage.locator('.not-found-home-link').click()
    await notFoundPage.waitForURL(`${baseUrl}/${locale}`)
  }

  const xssPayload = '<img src=x onerror="globalThis.__routeXss=true">'
  const xssResponse = await notFoundPage.goto(`${baseUrl}/en/${encodeURIComponent(xssPayload)}`, {
    waitUntil: 'networkidle',
  })
  assert.equal(xssResponse?.status(), 404)
  assert.equal(await notFoundPage.locator('.not-found-path img').count(), 0)
  assert.equal(await notFoundPage.evaluate(() => globalThis.__routeXss), undefined)
  assert.match(
    await notFoundPage.locator('.not-found-path').textContent(),
    /img(?:%20| )src(?:%3D|=)x/,
  )
  assert.deepEqual(await pageViolations(notFoundPage), [], 'route text must not violate the CSP')
  assert.deepEqual(
    [...notFoundExternalRequests],
    [],
    '404 navigation must not contact third-party origins',
  )
  assert.deepEqual(notFoundProblems, [], '404 pages must not report runtime or resource errors')
  await notFoundPage.close()

  const trustedTypesProbe = await page.evaluate(() => {
    const result = { html: false, script: false, scriptUrl: false }
    try {
      const target = document.createElement('div')
      target.innerHTML = '<img src=x onerror=alert(1)>'
    } catch (error) {
      result.html = error.name === 'TypeError'
    }
    try {
      const target = document.createElement('script')
      target.textContent = 'alert(1)'
    } catch (error) {
      result.script = error.name === 'TypeError'
    }
    try {
      const target = document.createElement('script')
      target.src = '/untrusted.js'
    } catch (error) {
      result.scriptUrl = error.name === 'TypeError'
    }
    return result
  })
  assert.deepEqual(trustedTypesProbe, { html: true, script: true, scriptUrl: true })
  await context.close()
}

async function sidebarGeometry(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
    const handle = document.querySelector('.sidebar .handle')?.getBoundingClientRect()
    const content = document.querySelector('.content')?.getBoundingClientRect()

    return {
      sidebarLeft: sidebar?.left,
      sidebarTop: sidebar?.top,
      sidebarWidth: sidebar?.width,
      handleTop: handle?.top,
      contentLeft: content?.left,
    }
  })
}

async function assertStableSidebarGeometry(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 } })
  const page = await context.newPage()
  const pageAnchors = [
    { path: '', sections: ['about', 'research', 'projects', 'contact', 'home'] },
    { path: '/resume', sections: ['education', 'experience', 'skills'] },
  ]

  for (const locale of ['en', 'es', 'ja']) {
    let resumeBaseline

    for (const { path, sections } of pageAnchors) {
      await page.goto(`${baseUrl}/${locale}${path}`, { waitUntil: 'networkidle' })
      await page.evaluate(async () => {
        await document.fonts.ready
        document.documentElement.style.scrollBehavior = 'auto'
      })
      const baseline = await sidebarGeometry(page)
      if (path === '/resume') resumeBaseline = baseline

      for (const section of sections) {
        await page.locator(`.side-nav [data-section="${section}"]`).click()
        await page.waitForTimeout(50)
        assert.deepEqual(
          await sidebarGeometry(page),
          baseline,
          `${locale}${path || '/'} #${section} must not move the desktop sidebar`,
        )
      }
    }

    await page.evaluate(() => {
      globalThis.__sidebarHandleTops = []
      const deadline = performance.now() + 1_000
      const sample = () => {
        const top = document.querySelector('.sidebar .handle')?.getBoundingClientRect().top
        if (top !== undefined) globalThis.__sidebarHandleTops.push(top)
        if (performance.now() < deadline) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.locator('.resume-home-nav-link').click()
    await page.waitForURL(`${baseUrl}/${locale}`)
    await page.waitForTimeout(1_000)
    const handleTops = await page.evaluate(() => globalThis.__sidebarHandleTops)
    assert.ok(handleTops.length > 0, `${locale} must sample the sidebar during navigation`)
    assert.deepEqual(
      [...new Set(handleTops)],
      [resumeBaseline.handleTop],
      `${locale} resume-to-home navigation must not move the handle between frames`,
    )
    assert.deepEqual(
      await sidebarGeometry(page),
      resumeBaseline,
      `${locale} resume-to-home navigation must not move the desktop sidebar`,
    )
  }

  await context.close()
}

async function assertInlineStylesheetBlocked(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await installViolationObserver(page)
  await page.goto(`${baseUrl}/en`, { waitUntil: 'networkidle' })

  const applied = await page.evaluate(() => {
    const target = document.createElement('div')
    target.id = 'csp-style-probe'
    document.body.appendChild(target)
    const style = document.createElement('style')
    style.textContent = '#csp-style-probe{--csp-probe:applied}'
    document.head.appendChild(style)
    return getComputedStyle(target).getPropertyValue('--csp-probe').trim()
  })
  assert.equal(applied, '', 'an unnonced inline stylesheet must not apply')
  assert.equal(
    (await pageViolations(page)).some(
      (violation) => violation.directive === 'style-src-elem' && violation.blocked === 'inline',
    ),
    true,
    'the browser must report the blocked inline stylesheet',
  )
  await context.close()
}

async function assertRecordingReplay(browser) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  const problems = []
  const externalRequests = new Set()
  await installViolationObserver(page)
  await page.goto(`${baseUrl}/en/missing-page`, { waitUntil: 'networkidle' })
  // Chromium reports the intentional 404 main-document response as a console
  // error. Begin runtime observation after that expected response is complete.
  observePage(page, problems, externalRequests)

  const avatar = page.locator('.mobile-header .avatar-hold')
  const box = await avatar.boundingBox()
  assert.ok(box, 'the recording avatar must be visible')
  const pointer = {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  }
  await avatar.dispatchEvent('pointerdown', pointer)
  await page.waitForTimeout(1150)
  await avatar.dispatchEvent('pointerup', { ...pointer, buttons: 0 })

  const stop = page.getByRole('button', { name: 'Stop recording' })
  await stop.waitFor({ state: 'visible', timeout: 30_000 })

  await page.locator('.not-found-home-link').click()
  await page.waitForURL(`${baseUrl}/en`)
  await page.locator('.pill-nav [data-section="about"]').click()
  await page.waitForTimeout(250)

  await stop.click()
  try {
    await page.locator('.replay-overlay-box #stage').waitFor({ state: 'visible', timeout: 45_000 })
  } catch (error) {
    const diagnostics = {
      violations: await pageViolations(page),
      problems,
      styles: await page.evaluate(() =>
        [...document.querySelectorAll('style')].map((style) => ({
          id: style.id,
          nonce: style.nonce,
          rules: style.sheet?.cssRules.length ?? null,
        })),
      ),
    }
    throw new Error(`Replay did not become visible: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    })
  }
  await page.locator('#downloadJson svg').waitFor({ state: 'attached' })
  await page.locator('#darkToggle svg').waitFor({ state: 'attached' })

  const downloadStarted = page.waitForEvent('download')
  await page.locator('#downloadJson').click()
  const download = await downloadStarted
  const downloadPath = await download.path()
  assert.ok(downloadPath, 'the replay JSON download must complete')
  const recordedBundle = JSON.parse(await readFile(downloadPath, 'utf8'))
  const snapshotRoot = recordedBundle.events.find((event) => event.type === 2)?.data?.node
  const snapshotNodes = snapshotRoot ? [snapshotRoot] : []
  let missingHeadingNode
  while (snapshotNodes.length > 0) {
    const node = snapshotNodes.pop()
    if (node?.type === 3 && node.textContent === 'Sorry, page not found.') {
      missingHeadingNode = node
      break
    }
    snapshotNodes.push(...(node?.childNodes ?? []))
  }
  assert.ok(missingHeadingNode, 'the initial 404 heading must be present in the snapshot')
  assert.equal(
    recordedBundle.overlay.ja[missingHeadingNode.id],
    'すみません。リンク先は利用できません。',
    'the recorded 404 heading must be available in the Japanese overlay',
  )

  const track = page.locator('#track')
  const trackBox = await track.boundingBox()
  assert.ok(trackBox, 'the replay scrubber must be measurable')
  const scrubTo = async (fraction) => {
    const clientX = trackBox.x + trackBox.width * fraction
    const clientY = trackBox.y + trackBox.height / 2
    const pointer = { pointerId: 7, pointerType: 'mouse', clientX, clientY, buttons: 1 }
    await track.dispatchEvent('pointerdown', pointer)
    await track.dispatchEvent('pointerup', { ...pointer, buttons: 0 })
    await page.waitForTimeout(350)
  }

  const replayDocument = page.frameLocator('#player iframe')
  await scrubTo(0)
  assert.equal(await replayDocument.locator('.not-found').count(), 1)
  assert.equal(
    await replayDocument.locator('.not-found h2').textContent(),
    'Sorry, page not found.',
  )

  const japaneseFlag = page.locator('#flags button[data-loc="ja"]')
  await japaneseFlag.click()
  await page.waitForTimeout(1_000)
  assert.equal(await japaneseFlag.getAttribute('class'), 'active')
  assert.equal(
    await replayDocument.locator('.not-found h2').textContent(),
    'すみません。リンク先は利用できません。',
  )

  await scrubTo(0.999)
  assert.equal(await replayDocument.locator('.not-found').count(), 0)
  assert.equal(await replayDocument.locator('#about').count(), 1)
  assert.equal(await replayDocument.locator('#about h2').textContent(), '概要')

  assert.deepEqual(await pageViolations(page), [], 'recording and replay must not violate the CSP')
  assert.deepEqual([...externalRequests], [], 'recording and replay must stay on the app origin')
  assert.deepEqual(problems, [], 'recording and replay must not report runtime errors')
  await context.close()
}

const serverOutput = []
const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()))
server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()))

let browser
try {
  await waitForServer(server, serverOutput)
  await assertHttpPolicy()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  await assertBrowserPolicy(browser)
  await assertStableSidebarGeometry(browser)
  await assertInlineStylesheetBlocked(browser)
  await assertRecordingReplay(browser)
  console.log('Security regression checks passed.')
} finally {
  await browser?.close()
  stopProcess(server)
  if (server.exitCode === null) {
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))])
  }
}
