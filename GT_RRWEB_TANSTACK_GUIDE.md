# Guide: Add gt-rrweb localized recording to a TanStack Start app (with `_tagIds`)

## Goal

Record a product walkthrough once with **gt-rrweb**, and harvest per-locale text so
the recording can be replayed in any of your app's languages. To get full `<T>`
coverage, enable GT's **id-tagging** (`_tagIds`), which stamps each `<T>` with a
`data-_gt-hash` attribute the harvester reads.

## Assumptions

- A working **TanStack Start** app already using **`gt-tanstack-start`** (i.e. you
  call `initializeGT(...)` in your router setup and wrap the app in `<GTProvider>`),
  and you have a `loadTranslations(locale)` function that returns a locale's
  published translations (hash → content).
- You render translatable UI with `<T>` and/or `gt()` / `useGT()`.

## Package versions

Use the GT packages at a version that ships id-tagging — **11.1.5 or later** (use the
latest 11.1.x). id-tagging is off by default and only exists from that version
onward. Keep the whole GT family (`gt-tanstack-start`, `gt-react`,
`@generaltranslation/react-core`, `gt-i18n`, `generaltranslation`) on one aligned
version to avoid duplicate instances.

---

## Step 1 — Install gt-rrweb + the rrweb recording peer

```bash
npm install gt-rrweb @rrweb/record
npm install -D @rrweb/types            # types only, if you use TypeScript
```

`gt-rrweb`'s recorder needs `@rrweb/record` at runtime (it's an optional peer).
`gt-react` is also an optional peer and is already present via `gt-tanstack-start`.

---

## Step 2 — Enable id-tagging (`_tagIds`) in `initializeGT`

Find your `initializeGT({ ... })` call (usually in `src/router.tsx`) and add
`_tagIds: true`:

```ts
import { initializeGT } from 'gt-tanstack-start'
import loadTranslations from './loadTranslations'

initializeGT({
  loadTranslations,
  // ...your existing options...

  // Stamp each <T> with its translation hash (data-_gt-hash) so gt-rrweb can
  // harvest per-locale text by hash. Off by default.
  _tagIds: true,
} as Parameters<typeof initializeGT>[0])
```

> **Why the cast?** `_tagIds` is forwarded to GT's runtime config and read at render
> time (`isIdTaggingEnabled()`), but it may not yet be listed on the published
> `initializeGT` param type. The `as Parameters<typeof initializeGT>[0]` cast passes
> it through without a type error and can be removed once the option is in the public
> type. Do **not** cast to `any`.

> ⚠️ **Hydration caveat.** `_tagIds` wraps any `<T>` that renders **bare text or a
> fragment** in a `<span style="display:contents">` (elements are annotated in place,
> no wrapper). A `<span>` is invalid inside `<option>`, `<title>`, `<select>`, some
> table groupings, and SVG — those spots can throw hydration mismatches. After
> enabling, load a few pages and watch the console; if a specific `<T>` warns, move it
> out of that context or leave that string as `gt()`.

**Verify tagging is live** (in the browser console):

```js
document.querySelectorAll('[data-_gt-hash]').length // should be > 0
```

---

## Step 3 — Mount the recorder at the app root

Add `<GTRecorder>` once, high in the tree (e.g. your `__root.tsx`, inside
`<GTProvider>`). It renders nothing until recording starts, then shows a capture
overlay.

```tsx
import { GTRecorder } from 'gt-rrweb'
import type { RecorderBundle, HarvestOptions } from 'gt-rrweb'
import { hashMessage } from 'gt-i18n/internal'
import loadTranslations from './loadTranslations'

const harvest: HarvestOptions = {
  // Your app's own loader — the harvester calls it per target locale and maps
  // the recorded hashes onto each locale's published translations.
  loadTranslations,

  // Optional: also cover gt()/useGT() strings (which render as bare text with no
  // DOM hash) by hashing their source. Omit to harvest only <T> content.
  hashMessage: (message: string) => hashMessage(message, { $format: 'ICU' }),

  // The locale you record in (the source render). Defaults to your GT locale.
  sourceLocale: 'en',
}

function handleComplete(bundle: RecorderBundle) {
  // bundle = { events, locales, overlay }
  //   events  : standard rrweb events (the recording)
  //   locales : the locales you traced, source first
  //   overlay : { [locale]: { [rrwebNodeId]: translatedText } }
  // Persist / upload / download it here.
  console.log('recorded', bundle.locales, Object.keys(bundle.overlay ?? {}))
}

// ...inside your root component's JSX, within <GTProvider>:
;<GTRecorder
  // CSS selector for the region to frame + harvest (defaults to `main`).
  contentSelector="main"
  // '16:9' reflows the content into a centered box while recording; or 'none'.
  frame="16:9"
  // Attach window.gtRecorder = { start, stop } for programmatic/automated driving.
  expose="gtRecorder"
  harvest={harvest}
  onComplete={handleComplete}
/>
```

> `hashMessage` comes from `gt-i18n/internal`. If it isn't resolvable, add `gt-i18n`
> as a direct dependency at the **same version** as the rest of your GT family.

---

## Step 4 — Drive it

**Option A — a UI button** (anywhere under `<GTProvider>`):

```tsx
import { useRecorder } from 'gt-rrweb'

function RecordButton() {
  const { isRecording, start, stop } = useRecorder()
  return (
    <button onClick={() => (isRecording ? stop() : start({ locales: ['en', 'fr', 'es'] }))}>
      {isRecording ? 'Stop' : 'Record'}
    </button>
  )
}
```

**Option B — programmatic / automated** (via the exposed handle):

```js
await window.gtRecorder.start({ locales: ['en', 'fr', 'es'] })
// ...navigate/click through the flow (in-app navigation keeps recording alive)...
const bundle = await window.gtRecorder.stop() // runs the harvest, returns the bundle
```

`locales` is source-first (`locales[0]` = the locale you record in). The harvest runs
during `stop()` and calls your `loadTranslations` once per target locale.

---

## Step 5 — Verify the harvest

After a `stop()`:

```js
const b = await window.gtRecorder.stop()
b.locales // e.g. ["en","fr","es"]
Object.keys(b.overlay.fr).length // > 0 → <T>/gt() text was harvested
```

If `overlay.fr` is small or empty:

- Confirm `document.querySelectorAll('[data-_gt-hash]').length > 0` on the recorded
  pages (id-tagging actually on).
- Confirm `loadTranslations('fr')` resolves to a non-empty hash→content map for that
  locale.
- Remember only text the site actually translates is covered — dynamic values
  (numbers, dates, `<Var>` / `<Num>` / `<DateTime>`), proper nouns, and any string
  **not** wrapped in `<T>` / `gt()` stay in the source language (this is faithful —
  it's what your live `/fr` page shows too).

---

## Notes

- **Framework-agnostic:** the recorder and harvester don't depend on any Next.js-only
  APIs. In TanStack you pass your app's own `loadTranslations` straight through — no
  server proxy route is needed.
- **Coverage:** `<T>` content is harvested via the `data-_gt-hash` attribute;
  `gt()` / `useGT()` strings via `hashMessage(source)`. Interpolated `gt()` strings
  (e.g. `gt('Hello {name}')`) won't match their template hash and stay source.
- **Output:** `bundle.events` is a normal rrweb event stream; `bundle.overlay` is the
  per-locale text keyed by rrweb node id. A localized replayer that consumes this
  bundle is a separate piece — until it's available, persist the bundle (it's
  self-describing).
