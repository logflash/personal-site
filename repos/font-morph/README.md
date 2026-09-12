# font-morph

A lightweight JavaScript library for morphing the same text between different fonts.

The library turns matching text elements into continuous font-shape animations.
Its preferred renderer interpolates build-generated signed-distance fields (SDFs);
the prepared SVG/KUTE renderer remains as a compatibility fallback. Both paths
support responsive destination tracking, deterministic absolute-progress rendering,
Unicode fallback fonts, and exact settled DOM text.

```sh
npm install font-morph
```

## Usage

Generate a serializable manifest for known text during the host application's build.
The compiler receives font buffers and viewport-independent font instances; its output
contains no viewport dimensions or DOM nodes. `compileFontMorphManifest()` produces a
version-1 prepared-outline manifest for the SVG/KUTE compatibility renderer. Applications
using the preferred SDF renderer compile glyph pairs and shaped runs with the
`font-morph/compiler` entry and combine them with those outlines in a version-2 manifest.
The SDF compiler is a Node/build-time API; it is not included in the browser runtime.

Structural registration is also automatic. During compilation, the library samples
each glyph pair, detects intermediate components or counters that do not occur at
either endpoint, and deterministically selects local, font-space warp controls that
remove those artifacts. Stable glyphs keep a zero-control fast path. No character,
font, or site-specific correction files are loaded at build time or runtime.

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { compileFontMorphManifest } from 'font-morph'

const [sansFile, serifFile] = await Promise.all([
  readFile('public/fonts/sans.ttf'),
  readFile('public/fonts/serif.ttf'),
])
const asArrayBuffer = (bytes: Buffer) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const sansBuffer = asArrayBuffer(sansFile)
const serifBuffer = asArrayBuffer(serifFile)

const manifest = await compileFontMorphManifest({ sans: [sansBuffer], serif: [serifBuffer] }, [
  {
    text: 'Resume',
    source: { role: 'sans', weight: 500, opticalSize: 0 },
    target: { role: 'serif', weight: 600, opticalSize: 23 },
  },
])
await writeFile('public/font-morph.json', JSON.stringify(manifest))
```

Write the manifest to a public JSON file. Then configure font URLs and its loader,
mark both text endpoints with
the same `data-font-morph` value, call `prepareFontMorph()` before interaction when
possible, then call `beginFontMorph()` immediately before the DOM changes.

```ts
import { beginFontMorph, configureFontMorph, prepareFontMorph } from 'font-morph'
import 'font-morph/styles.css'

let manifestRequest: Promise<unknown> | undefined
configureFontMorph({
  fontFiles: {
    sans: ['/fonts/sans.ttf'],
    serif: ['/fonts/serif.ttf'],
  },
  // Optional: use the exclusion class understood by your recorder.
  transientClass: 'recording-ignore',
  loadPreparedOutlines: () =>
    (manifestRequest ??= fetch('/font-morph.json').then((response) => {
      if (!response.ok) throw new Error(`Unable to load font morph data: ${response.status}`)
      return response.json()
    })),
  createWorker: () =>
    new Worker(new URL('/font-morph/outline-worker.js', location.origin), {
      type: 'module',
    }),
})

await prepareFontMorph('title')
beginFontMorph('title')
```

The distributed module worker is exported as `font-morph/outline-worker.js`.
Copy it to the public URL used above as part of the host build, or let a bundler import
that export as a worker URL. The worker loads the primary font pair first and only
fetches fallback faces when the requested text contains unsupported glyphs.

The destination must contain the same text and the same `data-font-morph` key.
Prepared correspondence is cached in font space, independently of viewport
dimensions. A missing manifest entry is compiled inside the configured worker.
If neither prepared data nor a worker is available, the library immediately reveals
the settled browser-rendered text instead of parsing fonts on the main thread.
When recording, configure `transientClass` with the recorder's ignore/block class so
generated layers and measurement probes do not enter the captured DOM.

The core package has no dependency on a router, UI framework, recording library,
or application-specific translations. `createFontMorphFrameRenderer()` accepts
absolute normalized progress, while `createFontMorphProgressController()` supports
interactive inputs such as sliders and scroll-linked effects. Recording and replay
packages should translate their own timelines into those absolute-progress frames.
The semantic recording event contains only transition identity, timing, normalized
endpoint boxes, and text styles; it never contains SDF textures, SVG paths, pixel
buffers, or per-frame output.

## Browser support

The runtime targets ES2022 browsers with Canvas 2D, SVG, `FontFaceSet`,
`MutationObserver`, `ResizeObserver`, and Web Workers. When prepared geometry or a
worker is unavailable, the destination DOM text is revealed immediately.

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
