import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { hashMessage } from 'gt-i18n/internal'
import { GTRecorder, useRecorder } from 'gt-rrweb'
import type { HarvestOptions, RecorderBundle } from 'gt-rrweb'
import { useEffect } from 'react'
import { GTProvider, getLocale, getTranslationsSnapshot } from 'gt-tanstack-start'
import type { ReactNode } from 'react'
import { DEFAULT_LOCALE, localeFromPath } from '../lib/localePath'
import loadTranslations from '../loadTranslations'
import fontsCssUrl from '../styles/fonts.css?url'
import globalCssUrl from '../styles/global.css?url'

// gt-rrweb harvest: maps the recorded hashes onto each locale's published
// translations via the app's own loader; hashMessage extends coverage to
// gt()/useGT()/msg() strings, which render as bare text with no DOM hash.
const harvest: HarvestOptions = {
  loadTranslations,
  hashMessage: (message: string) => hashMessage(message, { $format: 'ICU' }),
  sourceLocale: DEFAULT_LOCALE,
}

// Stopping a recording downloads the bundle (rrweb events + per-locale text
// overlay) as a .json for later replay.
function handleRecordingComplete(bundle: RecorderBundle) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `gt-recording-${bundle.locales[0]}-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

// While recording, global.css scales the whole site (.layout) down into the
// capture frame; this computes the scale factor, mirroring gt-rrweb's frame
// geometry (94vw usable width, 144px of vertical chrome, 16:9).
function CaptureScale() {
  const { isRecording } = useRecorder()

  useEffect(() => {
    if (!isRecording) return
    const update = () => {
      const frameWidth = Math.min(0.94 * window.innerWidth, (window.innerHeight - 144) * (16 / 9))
      document.documentElement.style.setProperty(
        '--gt-capture-scale',
        String(frameWidth / window.innerWidth),
      )
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--gt-capture-scale')
    }
  }, [isRecording])

  return null
}

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
      // optional). Preload every latin face: with `optional`, a face that
      // loses the load race falls back for the whole page view, and sans
      // 500/600 style *interaction* states (active nav item, item names) —
      // without them ready up front, moving the sidebar highlight flips
      // text between Plex and the system fallback, which reads as flicker.
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
      // Dev only: linked stylesheets keep CSS editing live; production
      // inlines the CSS below to remove the only render-blocking requests.
      ...(import.meta.env.DEV
        ? [
            { rel: 'stylesheet', href: fontsCssUrl },
            { rel: 'stylesheet', href: globalCssUrl },
          ]
        : []),
    ],
    styles: import.meta.env.DEV ? [] : [{ children: __INLINE_CSS__ }],
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
          <GTRecorder
            contentSelector=".layout"
            frame="16:9"
            expose="gtRecorder"
            harvest={harvest}
            onComplete={handleRecordingComplete}
          />
          <CaptureScale />
        </GTProvider>
        <Scripts />
      </body>
    </html>
  )
}
