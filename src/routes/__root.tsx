import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { GTProvider, getLocale, getTranslationsSnapshot } from 'gt-tanstack-start'
import type { ReactNode } from 'react'
import { DEFAULT_LOCALE, localeFromPath } from '../lib/localePath'
import globalCss from '../styles/global.css?url'

// Applies the saved theme before first paint to avoid a light-mode flash.
const THEME_SCRIPT = `try{if(localStorage.getItem('ian-site-theme')==='dark'){document.documentElement.dataset.theme='dark'}}catch(e){}`

export const Route = createRootRoute({
  loader: async ({ location }) => {
    // The path prefix is the source of truth; gtMiddleware's cookie/header
    // detection only decides where the bare `/` redirects (routes/index.tsx).
    const locale = localeFromPath(location.pathname) ?? getLocale() ?? DEFAULT_LOCALE
    return { locale, translations: await getTranslationsSnapshot(locale) }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/avatar.png' },
      // Self-hosted fonts (declared in styles/fonts.css with font-display:
      // optional). Preloading the latin subsets makes them reliably available
      // within the block window, so text renders atomically — no font swap.
      ...[
        'ibm-plex-sans-400-latin',
        'ibm-plex-sans-500-latin',
        'ibm-plex-sans-600-latin',
        'ibm-plex-sans-700-latin',
        'jetbrains-mono-400-latin',
        'source-serif-4-600-latin',
      ].map((font) => ({
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: `/fonts/${font}.woff2`,
        crossOrigin: 'anonymous' as const,
      })),
      { rel: 'stylesheet', href: globalCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const { locale, translations } = Route.useLoaderData()

  return (
    // suppressHydrationWarning: the theme script may set data-theme pre-hydration
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <GTProvider locale={locale} translations={translations}>
          {children}
        </GTProvider>
        <Scripts />
      </body>
    </html>
  )
}
