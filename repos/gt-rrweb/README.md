# gt-rrweb fork

Record a product walkthrough once with [rrweb](https://www.rrweb.io/), then replay it
per-locale using the host application's published translations.

This directory is a standalone workspace fork of `gt-rrweb@0.2.0`, copied from the
official `generaltranslation/gt` tag at commit
`ad4f69ed7847a055ea555a102f4e597b7a138d5d`. The unmodified upstream package tree is
`f8a44c1d425da0a993a6783b01cdb237681052ab`.

The fork keeps the original recorder, harvest, replay, unit-test, and browser-test
source. Local replay fixes are applied from the ordered source patch series by
`scripts/vendor-gt-rrweb.mjs`; the personal site resolves this TypeScript source
directly for hot reload.

## Verification

```sh
corepack pnpm --filter gt-rrweb typecheck
corepack pnpm --filter gt-rrweb test
corepack pnpm --filter gt-rrweb e2e
```

`e2e:fixture` regenerates the generic browser recording used by the E2E suite.

## Font morph replay

The optional `gt-rrweb/font-morph` entry adapts compact `font-morph` semantic
events to the directed replay clock:

```ts
import {
  createFontMorphReplayDirector,
  prepareFontMorphReplay,
  reserveFontMorphSettledTextHolds,
} from 'gt-rrweb/font-morph'
```

Install and configure `font-morph` in the host application before using this
entry. The adapter owns rrweb event parsing, locale resolution, settled-text holds,
seeking, and invisible-animation advancement. Compiled contours, distance fields,
pixel buffers, and per-frame output are never stored in the recording.

## License

MIT © General Translation, Inc. See `LICENSE.md`.
