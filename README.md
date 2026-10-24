# ianhenriques.com

TanStack Start (SSR) + React 19 + TypeScript, internationalized with
[gt-tanstack-start](https://generaltranslation.com/docs).

## Develop

```sh
npm install
npm run dev        # dev server (SSR)
npm run host       # dev server exposed on the local network
npm run build      # production build (dist/) + typecheck
npm run start      # serve the production build locally
```

## Resume

Edit wording in `src/content/Resume.mdx` and PDF layout in `resume/*.typ`.
The website and PDF share the MDX source; `ResumePdfOnly` and `pdfDetail` keep
PDF-only content off the website.

```sh
pnpm resume:build  # generate English, Spanish and Japanese PDFs from GT catalogs
pnpm resume:check  # verify all PDFs; enforce the <=20% orphan rule for English only
pnpm resume:watch  # rebuild when the MDX changes
```

For Tinymist, run the watcher and pin the preview of `resume/main.typ` before
editing MDX. Production builds generate and check the PDF before Vite; the check
uses deterministic text geometry and blocks deployment on failure.
Spanish and Japanese use normal wrapping without the orphan constraint.
The download follows the page language: `IanResume.pdf`, `IanResume_es.pdf`, or
`IanResume_ja.pdf`, generated in `public/` and `output/pdf/`. Translations live in
the existing `src/_gt` JSON catalogs; missing entries fail the build. Avenir is
retained for Latin text, with Noto Sans JP Light for Japanese. The watcher also
rebuilds on catalog and Typst changes. Tinymist defaults to English; set the Typst
input `locale=es` or `locale=ja` to preview another language.

## Test

```sh
pnpm build
pnpm test:accessibility
pnpm test:preferences
pnpm test:security
```

Accessibility checks cover English, Spanish, and Japanese on desktop and mobile,
light/dark themes, expanded cards, keyboard navigation, and the replay dialog.
The recorded iframe remains script-disabled; its controls and accessible name
are checked without executing the scanner inside the recording. Automated checks
complement, rather than replace, manual screen-reader testing.

Browser-preference checks cover reduced motion, system/explicit themes, forced
colors, increased contrast, blocked storage, and 320px reflow. They also run as
part of the accessibility and security suites.

### Local experiments

The project list has topic filters; publication details include copyable citations,
BibTeX, and links that reopen the paper; the homepage's “About this site” disclosure
contains a Glyphflux type specimen and a gt-rrweb recording button. New copy is
hand-translated in all three `src/_gt` catalogs. Citation metadata lives in
`src/data/publications.ts` and retains the publication's original language.

With a preview running on port 5174, run `pnpm test:experiments` to check the new
controls, clipboard failure handling, desktop/mobile accessibility, and translated
recording/replay. Set `EXPERIMENT_BASE_URL` to test a different local preview.
The local gt-rrweb fork also clamps rewinds to the first DOM snapshot and avoids
resetting an already-active scrub engine during idle warm-up.

`npm run host` serves the preview on the LAN. Citation copying uses the native
clipboard API where available and a synchronous selection-based fallback on
HTTP LAN origins. `npm run test:clipboard` exercises Chrome, Edge, Firefox, and
WebKit with mouse and touch, including actual copy/paste and denied permissions.
Set `EXPERIMENT_LAN_URL` to include a LAN address. Install Playwright Firefox and
WebKit first (`node node_modules/playwright-core/cli.js install firefox webkit`);
Chrome and Edge use their installed channels. Windows WebKit's async clipboard
does not round-trip through the OS in this test environment, so that case is
reported as unverified; these tests do not substitute for physical Safari or
Samsung Internet checks.

With the Vite preview on port 5173, `npm run test:font-endpoints` compares rendered
endpoint weights in both directions, all three languages, and desktop/mobile
layouts through the real gt-rrweb director. The shared Glyphflux renderer derives
weights from endpoint styles and hands the final frame directly to native text.
`npm run test:contribution-scroll` checks cue dismissal at the right edge across
the four browsers, including blocked storage and resizing.

## Internationalization

English (default), Spanish, and Japanese, routed by path prefix (`/en`, `/es`,
`/ja`). The prefix is the source of truth; the bare `/` is a server-side
redirect using gt-react's cookie, then `Accept-Language`, then the default.
`gtMiddleware` (`src/start.ts`) resolves the request locale and the root route
loader hydrates `GTProvider`. Page copy lives in `src/content/*.mdx`; the MDX
sync script registers that copy with GT, while shared chrome uses `useGT()` or
`msg()`/`useMessages()`.

```sh
npx gt auth        # writes GT_PROJECT_ID / GT_API_KEY to .env.local
npx gt translate   # emits translations to src/_gt/<locale>.json (commit these)
```

`.env.example` documents the expected variables.

## SEO

Every locale page is fully server-rendered: translated HTML, `<html lang>`,
per-locale meta description, OpenGraph/Twitter tags, canonical + `hreflang`
alternates, and JSON-LD Person markup (`src/lib/seo.ts`), plus
`public/robots.txt` and `public/sitemap.xml` with hreflang annotations.
Unknown paths redirect to the default locale.

## Deploy

Built for Vercel: connect the repo and Vercel auto-detects TanStack Start
(SSR in serverless functions, static assets on the CDN). `npm run start`
serves the same build locally via `scripts/serve.mjs`.

## Structure

- `src/routes/` — `__root.tsx` (document shell, GT hydration), `index.tsx`
  (locale redirect), `$locale.tsx` (the page + SEO head)
- `src/content/` — authored MDX for the page sections
- `src/data/site.ts` — shared identity and navigation data
- `src/components/` — page chrome plus the parameterized MDX section renderer
- `src/hooks/` — `useTheme` (light/dark, persisted to localStorage), `useHashRoute`
  (click-driven hash routing; scrolling to the top clears it), `useScrolled`
- `src/lib/seo.ts` — per-locale head tags; `src/lib/localePath.ts` — locale helpers
- `src/styles/global.css` — design tokens and responsive rules; the sidebar
  collapses to the mobile top bar below 880px
- `public/` — static assets, including the future `gt-contributions` collection
