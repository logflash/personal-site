# ianhenriques.com

React 19 + TypeScript + Vite.

## Develop

```sh
npm install
npm run dev        # dev server
npm run host       # dev server exposed on the local network
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
```

## Internationalization (gt-react)

The site supports English (default), Spanish, and Japanese via
[gt-react](https://generaltranslation.com/docs/react). `src/index.ts` awaits
`initializeGTSPA()` before loading the app, so module-level `t()` calls in
`src/data/site.ts` resolve in the active locale; JSX content uses `<T>`/`<Var>`,
and a `<LocaleSelector />` sits in the sidebar footer and mobile top bar.

Workflow:

```sh
npx gt auth        # writes GT_PROJECT_ID / GT_API_KEY to .env.local
npx gt translate   # emits translations to src/_gt/<locale>.json (commit these)
```

`.env.example` documents the expected variables (copy it to `.env`). For dev-mode hot translation, set the
`VITE_GT_PROJECT_ID` / `VITE_GT_DEV_API_KEY` pair (development key only — VITE_
vars are exposed to the browser). Locales are configured in `gt.config.json`.
Without credentials or translations the site renders the English source.

Locales are routed by path prefix (`/en`, `/es`, `/ja`); the prefix is the
source of truth, and a bare `/` resolves from gt-react's cookie, then browser
language, then the default before the URL is canonicalized. When deploying to
a static host, add an SPA rewrite so `/es` etc. serve `index.html`.

## Structure

- `src/data/site.ts` — all content (nav, intro, timeline, papers, repos, contact)
- `src/components/` — presentational components; `sections/` holds the page sections
- `src/hooks/` — `useTheme` (light/dark, persisted to localStorage), `useScrollSpy`,
  `useHashRoute` (scroll-driven hash routing on mobile)
- `src/styles/global.css` — design tokens and responsive rules; the sidebar
  collapses to the mobile top bar below 880px
- `public/` — avatar, resume PDF
