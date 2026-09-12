# Fork notes

## Provenance

- Upstream repository: `https://github.com/generaltranslation/gt.git`
- Upstream tag: `gt-rrweb@0.2.0`
- Commit: `ad4f69ed7847a055ea555a102f4e597b7a138d5d`
- `packages/rrweb` tree: `f8a44c1d425da0a993a6783b01cdb237681052ab`

Run `node scripts/vendor-gt-rrweb.mjs --check` from the personal-site root to clone
that exact revision, verify both Git object IDs, apply every ordered source patch with
`git apply --check`, and compare the result with this directory. Pass `--source` with
an existing checkout to perform the same verification without a network request.

## Source-level changes

The source patch series replaces the former package-manager patch against generated
`dist` files. It carries these generic replay and harvesting behaviors:

- associate separately-added rrweb text mutations with their nearest hash owner,
  including child-before-parent mutation batches;
- compress inactive time while retaining click, font-morph, and settled-text holds;
- adapt compact font-morph events to the rrweb timeline through the optional
  `gt-rrweb/font-morph` entry, keeping renderer geometry out of recordings;
- interpolate scroll tracks deterministically and keep translated click targets in
  view when localized layouts differ;
- make cursor and scroll state depend only on replay time, including after seeks;
- distinguish mouse clicks, touch taps, swipes, cancellations, and off-frame pointer
  samples; touch playback hides the cursor while retaining a prominent tap ripple;
- synchronize locale selects and document language during translated playback;
- expose the per-frame director hook and deterministic `advanceTo` directive;
- avoid an artificial initial wait when a recording contains no stylesheet links;
- retain the JSON download, locale controls, and replay HUD layout used by hosts.

The pure timeline and input routines are covered in `src/replay/__tests__`. The browser
suite records and replays a generic localized fixture, then checks locale swapping,
scroll interpolation, click targeting, seeking, touch behavior, JSON export, initial
rendering, frame directives, and debug hot-swapping. It intentionally contains no
KUTE- or personal-site-specific assertions.
