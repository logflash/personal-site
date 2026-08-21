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
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        // Only the weights the stylesheet uses: mono 400; sans 400-700; serif 600
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,600&display=swap',
      },
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
