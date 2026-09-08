# font-morph

A lightweight JavaScript library for morphing the same text between different fonts.

The library turns matching text elements into topology-preserving SVG outline
animations. It supports precomputed KUTE correspondence, per-contour interpolation,
responsive destination tracking, deterministic time-based replay, Unicode fallback
fonts, and a final handoff to browser-rendered text.

This package currently lives as a local workspace repository while its public API and
tests mature. It has no upstream remote or vendored third-party source.

## Usage

Configure outline files once, mark both text endpoints with the same
`data-font-morph` value, call `prepareFontMorph()` before interaction when possible,
then call `beginFontMorph()` immediately before the DOM changes.

```ts
import { beginFontMorph, configureFontMorph, prepareFontMorph } from 'font-morph'
import 'font-morph/styles.css'

configureFontMorph({
  fontFiles: {
    sans: ['/fonts/sans.ttf'],
    serif: ['/fonts/serif.ttf'],
  },
})

await prepareFontMorph('title')
beginFontMorph('title')
```

The destination must contain the same text and the same `data-font-morph` key. Font
files are loaded lazily and parsed in the browser; KUTE correspondence is cached in
font space, independently of viewport dimensions.

The core package has no dependency on a router, UI framework, recording library,
or application-specific translations. Its optional replay helpers accept structural
event and frame types, so a host can connect them to any deterministic replay clock.
The replay reader also accepts the legacy `gt-font-morph` event tag, keeping recordings
from before this package extraction compatible.

## Verification

```sh
corepack pnpm --filter font-morph lint
corepack pnpm --filter font-morph typecheck
corepack pnpm --filter font-morph test
corepack pnpm --filter font-morph e2e
```
