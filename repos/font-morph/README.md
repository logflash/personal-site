# font-morph

A lightweight JavaScript library for morphing the same text between different fonts.

The library turns matching text elements into continuous font-shape animations.
Its preferred renderer interpolates build-generated signed-distance fields; the
earlier prepared SVG/KUTE renderer remains as a compatibility fallback for text
that has not been compiled. Both paths support responsive destination tracking,
deterministic time-based replay, Unicode fallback fonts, and exact settled DOM text.

This package currently lives as a local workspace repository while its public API and
tests mature. It has no upstream remote or vendored third-party source.

## Usage

Generate a serializable manifest for known text during the host application's build.
The compiler receives font buffers and viewport-independent font instances; its output
contains no viewport dimensions or DOM nodes. Host applications can combine prepared
SDF glyph pairs and shaped runs in a version-2 manifest while retaining version-1
outlines as a fallback. The personal-site integration discovers its strings, locales,
font stacks, responsive weights, and optical sizes automatically from MDX, translation
catalogs, and CSS.

```ts
import { compileFontMorphManifest } from 'font-morph'

const manifest = await compileFontMorphManifest(
  { sans: [sansBuffer], serif: [serifBuffer] },
  [
    {
      text: 'Resume',
      source: { role: 'sans', weight: 500, opticalSize: 0 },
      target: { role: 'serif', weight: 600, opticalSize: 23 },
    },
  ],
)
```

Configure font URLs and a manifest loader once, mark both text endpoints with
the same `data-font-morph` value, call `prepareFontMorph()` before interaction when
possible, then call `beginFontMorph()` immediately before the DOM changes.

```ts
import { beginFontMorph, configureFontMorph, prepareFontMorph } from 'font-morph'
import 'font-morph/styles.css'

configureFontMorph({
  fontFiles: {
    sans: ['/fonts/sans.ttf'],
    serif: ['/fonts/serif.ttf'],
  },
  loadPreparedOutlines: (text) => fetch(`/morphs/${localeFor(text)}.json`).then((r) => r.json()),
  createWorker: () => new Worker(fontMorphWorkerUrl, { type: 'module' }),
})

await prepareFontMorph('title')
beginFontMorph('title')
```

The distributed module worker is exported as `font-morph/outline-worker.js`.
Applications can expose that URL directly or let their bundler construct the worker
from it. The worker loads the primary font pair first and only fetches fallback faces
when the requested text contains unsupported glyphs.

The destination must contain the same text and the same `data-font-morph` key.
Prepared correspondence is cached in font space, independently of viewport
dimensions. A missing manifest entry is compiled inside the configured worker.
If neither prepared data nor a worker is available, the library immediately reveals
the settled browser-rendered text instead of parsing fonts on the main thread.

The core package has no dependency on a router, UI framework, recording library,
or application-specific translations. Its optional replay helpers accept semantic
event and frame types, so a host can connect them to any deterministic replay clock.
The replay reader also accepts the legacy `gt-font-morph` event tag, keeping recordings
from before this package extraction compatible. Recordings store only the semantic
transition identity, timing, normalized endpoint boxes, and text styles; SDF textures,
SVG paths, and per-frame output never enter the recording.

## React + TypeScript demo

The isolated demo renders English, Spanish, and Japanese text. Its two low-opacity
endpoints stay mounted while a range input scrubs the morph between their exact boxes.
Use `?renderer=sdf` for the signed-distance renderer; the default view retains the
controlled SVG fallback for comparison.

```sh
corepack pnpm --filter font-morph demo
```

The demo is served by Vite with hot reloading. It lives entirely under `demo/` and is
not bundled into the package or the parent personal site.

## Verification

```sh
corepack pnpm --filter font-morph lint
corepack pnpm --filter font-morph typecheck
corepack pnpm --filter font-morph test
corepack pnpm --filter font-morph e2e
corepack pnpm --filter font-morph demo:test
```
