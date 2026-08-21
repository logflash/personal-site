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

## Internationalization

English (default), Spanish, and Japanese, routed by path prefix (`/en`, `/es`,
`/ja`). The prefix is the source of truth; the bare `/` is a server-side
redirect using gt-react's cookie, then `Accept-Language`, then the default.
`gtMiddleware` (src/start.ts) resolves the request locale, the root route
loader hydrates `GTProvider`, and content uses `<T>`, `useGT()`, and
`msg()`/`useMessages()` (for strings in `src/data/site.ts`, which are
registered at module scope and decoded at render time).

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
- `src/data/site.ts` — all content (nav, intro, timeline, papers, repos, contact)
- `src/components/` — presentational components; `sections/` holds the page sections
- `src/hooks/` — `useTheme` (light/dark, persisted to localStorage), `useScrollSpy`,
  `useHashRoute` (scroll-driven hash routing on mobile)
- `src/lib/seo.ts` — per-locale head tags; `src/lib/localePath.ts` — locale helpers
- `src/styles/global.css` — design tokens and responsive rules; the sidebar
  collapses to the mobile top bar below 880px
- `public/` — avatar, resume PDF, robots.txt, sitemap.xml
