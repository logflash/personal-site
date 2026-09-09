# font-morph

A lightweight JavaScript library for morphing the same text between different fonts.

The library turns matching text elements into topology-preserving SVG outline
animations. It supports build-generated KUTE correspondence, worker-only runtime
compilation, per-contour interpolation, responsive destination tracking,
deterministic time-based replay, Unicode fallback fonts, and a final handoff to
browser-rendered text.

This package currently lives as a local workspace repository while its public API and
tests mature. It has no upstream remote or vendored third-party source.

## Usage

Generate a serializable manifest for known text during the host application's build.
The compiler receives font buffers and viewport-independent font instances; its normalized
output contains no viewport dimensions or DOM nodes.

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

Configure outline URLs and a manifest loader once, mark both text endpoints with
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
or application-specific translations. Its optional replay helpers accept structural
event and frame types, so a host can connect them to any deterministic replay clock.
The replay reader also accepts the legacy `gt-font-morph` event tag, keeping recordings
from before this package extraction compatible.

## React + TypeScript demo

The isolated demo renders the real controlled-progress API against English, Spanish,
and Japanese text. Its two low-opacity endpoints stay mounted while a range input
scrubs the topology-preserving SVG outline between their exact boxes.

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
