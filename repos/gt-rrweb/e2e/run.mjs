// Replayer e2e: serve the harness + built dist, drive a real Chromium, and assert
// the player's behaviors against e2e/fixture.json (regenerate with `pnpm e2e:fixture`).
// Scenarios: mount/reveal + capture-frame crop, per-locale text overlay (both the
// <T>-hash and gt()-string harvest paths), live locale switching, initialLocale,
// switchLocalesAllowed:false, the events-only embedded-overlay fallback, the
// synthesized cursor, the dark toggle, and debug drag-drop (graceful failure +
// hot-swap). Exits non-zero on any failure.
import { getBrowser, newPage } from './browser.mjs';
import { startServer } from './serve.mjs';

const PORT = 5642;
const BASE = `http://localhost:${PORT}`;

const SOURCE_TEXT = 'Welcome to the fixture';
const ES_T = [
  'Bienvenido al fixture internacional de reproducción localizada',
  'Ejecutar la demo',
]; // <T> hash path
const ES_STR = 'Los ajustes y proyectos viven aquí'; // gt()-string path

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(
    `${ok ? '  ✅' : '  ❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`,
  );
}

const pageErrors = [];
async function open(browser, query) {
  const page = await newPage(browser);
  page.on('pageerror', (e) =>
    pageErrors.push(`${query || '/'}: ${String(e).slice(0, 160)}`),
  );
  // Real device metrics (page.setViewportSize is a no-op over CDP).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__GT_REPLAYER_READY__ === true,
    null,
    {
      timeout: 15000,
    },
  );
  await page.waitForTimeout(1500); // reveal gate + first frames
  return page;
}

const replayText = (page) =>
  page.evaluate(
    () =>
      document.querySelector('#app #player iframe')?.contentDocument?.body
        ?.innerText || '',
  );

async function seek(page, fraction) {
  const box = await page.locator('#app #track').boundingBox();
  const x = box.x + box.width * fraction;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function clickControl(page, selector) {
  const stage = await page.locator('#app #stage').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.waitForSelector('#app #scrubber.show');
  await page.click(selector);
}

const server = await startServer(PORT);
const { browser, close } = await getBrowser();
try {
  // ---- scenario 1: default (source render, switching, cursor, theme) ---- //
  {
    const page = await open(browser, '');

    check('player mounts a replay iframe', (await replayText(page)).length > 0);
    check(
      'source render shows source text',
      (await replayText(page)).includes(SOURCE_TEXT),
    );

    // Capture-frame crop: the stage must take the recorded frame's 16:9 box, not
    // the recording viewport's shape.
    const ratio = await page.evaluate(() => {
      const r = document.querySelector('#app #stage').getBoundingClientRect();
      return r.width / r.height;
    });
    check(
      'stage crops to the capture frame (16:9)',
      Math.abs(ratio - 16 / 9) < 0.05,
      `ratio=${ratio.toFixed(3)}`,
    );
    const semanticOverlay = await page.evaluate(() =>
      window.__GT_FRAMES__.find(
        (frame) => frame.hasOverlay && frame.overlayWidth && frame.overlayHeight,
      ),
    );
    check(
      'frame directors receive a safe overlay aligned to the capture frame',
      Boolean(semanticOverlay) &&
        Number.parseFloat(semanticOverlay.overlayWidth) > 0 &&
        Number.parseFloat(semanticOverlay.overlayHeight) > 0,
      JSON.stringify(semanticOverlay),
    );

    // Director cursor: recorded-size (scaled), positioned inside the stage.
    const cursor = await page.evaluate(() => {
      const c = document.querySelector('#app #cursor');
      const stage = document
        .querySelector('#app #stage')
        .getBoundingClientRect();
      const r = c.getBoundingClientRect();
      return {
        transform: c.style.transform,
        inStage:
          r.left >= stage.left - 1 &&
          r.top >= stage.top - 1 &&
          r.left <= stage.right &&
          r.top <= stage.bottom,
      };
    });
    check(
      'cursor is scaled to recording size',
      /translate\(.+\) scale\(/.test(cursor.transform),
      cursor.transform,
    );
    check('cursor sits inside the stage', cursor.inStage);

    await page
      .waitForFunction(
        () =>
          new Set(
            window.__GT_FRAMES__
              .map((frame) => frame.scrollTop)
              .filter((value) => typeof value === 'number')
              .map((value) => Math.round(value)),
          ).size >= 6,
        null,
        { timeout: 3_000 },
      )
      .catch(() => undefined);
    const scrollSamples = await page.evaluate(() =>
      window.__GT_FRAMES__
        .map((frame) => frame.scrollTop)
        .filter((value) => typeof value === 'number'),
    );
    const distinctScrolls = new Set(
      scrollSamples.map((value) => Math.round(value)),
    );
    check(
      'scroll is rendered as a smooth frame sequence',
      distinctScrolls.size >= 6 &&
        [...distinctScrolls].some(
          (value) => ![0, 90, 190, 290].includes(value),
        ),
      `distinct=${distinctScrolls.size}`,
    );

    // Locale switcher: source + target flags, live in-place switching.
    const locs = await page.evaluate(() =>
      [...document.querySelectorAll('#app #flags button')].map(
        (b) => b.dataset.loc,
      ),
    );
    check(
      'flag switcher lists source-first locales',
      JSON.stringify(locs) === JSON.stringify(['en', 'es']),
      JSON.stringify(locs),
    );
    const flagStyle = await page.evaluate(() => {
      const style = getComputedStyle(
        document.querySelector('#app #flags button'),
      );
      return {
        display: style.display,
        alignItems: style.alignItems,
        lineHeight: style.lineHeight,
        separators: document.querySelectorAll('#app .hudsep').length,
      };
    });
    check(
      'locale labels are vertically centered',
      ['flex', 'inline-flex'].includes(flagStyle.display) &&
        flagStyle.alignItems === 'center' &&
        flagStyle.lineHeight === '17px',
      JSON.stringify(flagStyle),
    );
    check(
      'HUD has only the locale separator',
      flagStyle.separators === 1,
      `separators=${flagStyle.separators}`,
    );

    await clickControl(page, '#app #flags button[data-loc="es"]');
    await page.waitForTimeout(600);
    let text = await replayText(page);
    check(
      'es: <T> hash-path text swapped',
      ES_T.every((s) => text.includes(s)),
    );
    check('es: gt()-string-path text swapped', text.includes(ES_STR));
    check('es: source text gone', !text.includes(SOURCE_TEXT));
    const localizedState = await page.evaluate(async () => {
      const iframe = document.querySelector('#app #player iframe');
      const idoc = iframe.contentDocument;
      const target = idoc.getElementById('go').getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      const scale = iframeRect.width / iframe.offsetWidth;
      const fxRect = document.querySelector('#app #fx').getBoundingClientRect();
      const cursorTransform = document
        .querySelector('#app #cursor')
        .style.transform.match(
          /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/,
        );
      const cursor = cursorTransform
        ? {
            x: fxRect.left + Number(cursorTransform[1]),
            y: fxRect.top + Number(cursorTransform[2]),
          }
        : null;
      const targetHost = {
        left: iframeRect.left + target.left * scale,
        top: iframeRect.top + target.top * scale,
        right: iframeRect.left + target.right * scale,
        bottom: iframeRect.top + target.bottom * scale,
      };
      const fixture = await fetch('/fixture.json').then((response) =>
        response.json(),
      );
      const click = fixture.events.find(
        (event) =>
          event.type === 3 && event.data.source === 2 && event.data.type === 1,
      );
      return {
        lang: idoc.documentElement.lang,
        localeValue: idoc.getElementById('locale').value,
        recordedClickInsideTarget:
          click.data.y >= target.top && click.data.y <= target.bottom,
        cursorInsideTarget:
          cursor != null &&
          cursor.x >= targetHost.left &&
          cursor.x <= targetHost.right &&
          cursor.y >= targetHost.top &&
          cursor.y <= targetHost.bottom,
        scrollTop: idoc.getElementById('scrollbox').scrollTop,
      };
    });
    check(
      'locale controls and document language follow replay locale',
      localizedState.lang === 'es' && localizedState.localeValue === 'es',
      JSON.stringify(localizedState),
    );
    check(
      'translated replay keeps the captured scroll destination unchanged',
      localizedState.scrollTop === 285,
      JSON.stringify(localizedState),
    );
    check(
      'synthetic cursor corrects a translated click without moving the viewport',
      !localizedState.recordedClickInsideTarget &&
        localizedState.cursorInsideTarget,
      JSON.stringify(localizedState),
    );

    const downloadPromise = page.waitForEvent('download');
    await clickControl(page, '#app #downloadJson');
    const download = await downloadPromise;
    let downloadedJson = '';
    for await (const chunk of await download.createReadStream()) {
      downloadedJson += chunk.toString();
    }
    const downloadedBundle = JSON.parse(downloadedJson);
    check(
      'download control exports the unmodified recording bundle',
      /^gt-replay-en-\d{4}-\d{2}-\d{2}\.json$/.test(
        download.suggestedFilename(),
      ) &&
        downloadedBundle.events.length === 16 &&
        downloadedBundle.locales.join(',') === 'en,es',
    );

    await clickControl(page, '#app #flags button[data-loc="en"]');
    await page.waitForTimeout(600);
    text = await replayText(page);
    check(
      'back to source: es text gone',
      text.includes(SOURCE_TEXT) && !text.includes(ES_T[0]),
    );

    // Dark toggle drives the RECORDING's own theme mechanism (.dark class here).
    const bgBefore = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('#app #player iframe').contentDocument.body,
        ).backgroundColor,
    );
    await clickControl(page, '#app #darkToggle');
    await page.waitForTimeout(400);
    const dark = await page.evaluate(() => {
      const idoc = document.querySelector(
        '#app #player iframe',
      ).contentDocument;
      return {
        hasClass: idoc.documentElement.classList.contains('dark'),
        bg: getComputedStyle(idoc.body).backgroundColor,
      };
    });
    check(
      'dark toggle applies the recorded theme mechanism',
      dark.hasClass && dark.bg !== bgBefore,
      `bg ${bgBefore} → ${dark.bg}`,
    );

    // debug defaults OFF: a drop must be inert (no notice, no swap).
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(['garbage{{{'], 'x.json', { type: 'application/json' }),
      );
      document
        .getElementById('app')
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true }),
        );
    });
    await page.waitForTimeout(300);
    check(
      'debug off: drop is inert',
      await page.evaluate(() => !document.querySelector('.gt-debug-notice')),
    );
    await page.close();
  }

  // ---- scenario 2: initialLocale renders localized from the start -------- //
  {
    const page = await open(browser, '?locale=es');
    const text = await replayText(page);
    check(
      'initialLocale=es renders localized',
      ES_T.every((s) => text.includes(s)) && !text.includes(SOURCE_TEXT),
    );
    await page.close();
  }

  // ---- scenario 3: switchLocalesAllowed:false hides the switcher --------- //
  {
    const page = await open(browser, '?locales=off');
    const hud = await page.evaluate(() => ({
      flags: document.querySelectorAll('#app #flags button').length,
      sepHidden:
        document.querySelector('#app #localeSep')?.style.display === 'none',
    }));
    check(
      'switchLocalesAllowed:false shows no flags',
      hud.flags === 0 && hud.sepHidden,
    );
    check('…and still plays', (await replayText(page)).includes(SOURCE_TEXT));
    await page.close();
  }

  // ---- scenario 6: seek/reseek is video-like and history-independent ---- //
  {
    const page = await open(browser, '');
    await seek(page, 0.25);
    const first = await page.evaluate(() => ({
      cursor: document.querySelector('#app #cursor').style.transform,
      scrollTop: document
        .querySelector('#app #player iframe')
        .contentDocument.getElementById('scrollbox').scrollTop,
      opacity: document.querySelector('#app #scaler').style.opacity,
    }));
    await seek(page, 0.8);
    await seek(page, 0.25);
    const repeated = await page.evaluate(() => ({
      cursor: document.querySelector('#app #cursor').style.transform,
      scrollTop: document
        .querySelector('#app #player iframe')
        .contentDocument.getElementById('scrollbox').scrollTop,
      opacity: document.querySelector('#app #scaler').style.opacity,
    }));
    check(
      'revisiting a timestamp has no cursor or scroll hysteresis',
      repeated.cursor === first.cursor &&
        Math.abs(repeated.scrollTop - first.scrollTop) < 0.1,
      `${JSON.stringify(first)} → ${JSON.stringify(repeated)}`,
    );
    check(
      'scrubbing keeps the reconstructed stage visible',
      first.opacity === '1' && repeated.opacity === '1',
    );
    await page.close();
  }

  // ---- locale switch after engine-backed scrub preserves replay time ----- //
  {
    const page = await open(browser, '');
    await seek(page, 0.8);
    const before = await page.locator('#app #time').textContent();
    await clickControl(page, '#app #flags button[data-loc="es"]');
    await page.waitForTimeout(150);
    const after = await page.locator('#app #time').textContent();
    check(
      'locale switching after a scrub preserves the engine timestamp',
      before === after,
      `${before} → ${after}`,
    );
    await seek(page, 0.45);
    await clickControl(page, '#app #flags button[data-loc="en"]');
    await page.waitForTimeout(150);
    await seek(page, 0.45);
    const text = await replayText(page);
    check(
      'seeking after repeated locale switches does not restore stale engine text',
      text.includes(SOURCE_TEXT) && !text.includes(ES_T[0]),
    );
    await page.close();
  }

  // ---- scenario 7: absolute touch controls hide cursor, retain ripple --- //
  {
    const page = await open(browser, '?touch=1');
    const cursorHidden = await page.evaluate(
      () => !document.querySelector('#app #cursor').classList.contains('on'),
    );
    let prominentRipple = false;
    for (const fraction of [0.35, 0.45, 0.55, 0.65, 0.75]) {
      await seek(page, fraction);
      const ripple = await page.evaluate(() => {
        const ring = document.querySelector('#app .gt-ring');
        return {
          shown: ring.style.display !== 'none',
          width: Number.parseFloat(ring.style.width || '0'),
          borderWidth: ring.style.borderWidth,
          background: ring.style.background,
        };
      });
      if (
        ripple.shown &&
        ripple.width >= 22 &&
        ripple.borderWidth === '3px' &&
        ripple.background !== 'transparent'
      ) {
        prominentRipple = true;
        break;
      }
    }
    check('touch mode hides the synthesized cursor', cursorHidden);
    check(
      'touch mode retains a prominent deterministic tap ripple',
      prominentRipple,
    );
    await page.close();
  }

  // ---- scenario 8: off-frame pointer data never seeds the cursor -------- //
  {
    const page = await open(browser, '?offscreen=1');
    await seek(page, 0);
    const position = await page.evaluate(() => {
      const cursor = document
        .querySelector('#app #cursor')
        .getBoundingClientRect();
      const stage = document
        .querySelector('#app #stage')
        .getBoundingClientRect();
      return { cursor: cursor.toJSON(), stage: stage.toJSON() };
    });
    check(
      'off-frame interactions are ignored for the initial cursor position',
      position.cursor.left > position.stage.left + 1 &&
        position.cursor.left <= position.stage.right &&
        position.cursor.top >= position.stage.top &&
        position.cursor.top <= position.stage.bottom,
      JSON.stringify(position),
    );
    await page.close();
  }

  // ---- scenario 9: frame director can advance and receives teardown ----- //
  {
    const page = await open(browser, '?advance=1');
    const advanced = await page.evaluate(() => {
      const finite = window.__GT_FRAMES__.filter((frame) =>
        Number.isFinite(frame.time),
      );
      return {
        first: finite[0]?.time,
        reached: finite.some((frame) => frame.time >= 700),
      };
    });
    check(
      'onFrame can advance to a deterministic settled timestamp',
      advanced.first < 100 && advanced.reached,
      JSON.stringify(advanced),
    );
    const teardown = await page.evaluate(() => {
      window.__GT_REPLAYER_HANDLE__.destroy();
      const last = window.__GT_FRAMES__.at(-1);
      return (
        Number.isNaN(last.time) &&
        last.hasDocument === false &&
        last.hasOverlay === false
      );
    });
    check('onFrame receives an explicit teardown frame', teardown);
    await page.close();
  }

  // ---- scenario 4: events-only bundle → embedded-overlay fallback -------- //
  {
    const page = await open(browser, '?strip=1&locale=es');
    const text = await replayText(page);
    const flags = await page.evaluate(
      () => document.querySelectorAll('#app #flags button').length,
    );
    check(
      'events-only bundle recovers locales from the stream',
      flags === 2,
      `flags=${flags}`,
    );
    check(
      'events-only bundle still localizes',
      ES_T.every((s) => text.includes(s)),
    );
    await page.close();
  }

  // ---- scenario 5: debug drag-drop (graceful failure + hot-swap) ---------- //
  {
    const page = await open(browser, '?debug=1');
    const drop = (content, name) =>
      page.evaluate(
        ([c, n]) => {
          const dt = new DataTransfer();
          dt.items.add(new File([c], n, { type: 'application/json' }));
          document
            .getElementById('app')
            .dispatchEvent(
              new DragEvent('drop', { dataTransfer: dt, bubbles: true }),
            );
        },
        [content, name],
      );

    await drop('garbage{{{', 'broken.json');
    await page.waitForTimeout(300);
    const notice = await page.evaluate(
      () => document.querySelector('.gt-debug-notice')?.textContent || '',
    );
    check(
      'debug: non-JSON drop fails gracefully',
      notice.includes('Not a JSON file'),
      notice,
    );
    check(
      'debug: player survives a bad drop',
      (await replayText(page)).includes(SOURCE_TEXT),
    );

    // Drop the fixture's raw EVENTS ARRAY: hot-swap + array coercion + fallback.
    const eventsJson = await page.evaluate(() =>
      fetch('/fixture.json')
        .then((r) => r.json())
        .then((b) => JSON.stringify(b.events)),
    );
    await drop(eventsJson, 'events.json');
    await page.waitForTimeout(2000);
    // Exactly one #player: destroy() cleared the old instance, no stacked players.
    const swapped = await page.evaluate(() => ({
      flags: document.querySelectorAll('#app #flags button').length,
      players: document.querySelectorAll('#app #player').length,
    }));
    check(
      'debug: events-array drop hot-swaps the replay',
      swapped.players === 1 && (await replayText(page)).includes(SOURCE_TEXT),
      JSON.stringify(swapped),
    );
    check(
      'debug: swapped replay recovers embedded locales',
      swapped.flags === 2,
      `flags=${swapped.flags}`,
    );
    await page.close();
  }

  check(
    'no page errors across all scenarios',
    pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '),
  );
} finally {
  await close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length) process.exitCode = 1;
