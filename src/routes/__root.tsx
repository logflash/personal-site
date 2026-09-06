import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { hashMessage } from 'gt-i18n/internal'
import { GTRecorder, useRecorder } from 'gt-rrweb'
import type { HarvestOptions, RecorderBundle } from 'gt-rrweb'
import { useEffect, useState } from 'react'
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

const MOBILE_VIEWPORT = '(max-width: 880px)'
const DESKTOP_ASPECT = 16 / 9
const MOBILE_ASPECT = 3 / 4
const MOBILE_FRAME = { aspect: MOBILE_ASPECT } as const
const DESKTOP_LABELS = { rec: 'REC · 16:9' }
const MOBILE_LABELS = { rec: 'REC · 3:4' }

// While recording, global.css scales the whole site (.layout) down into the
// capture frame. The aspect is supplied by ResponsiveRecorder and remains
// fixed for the entire recording.
function CaptureScale({ aspect }: { aspect: number }) {
  useEffect(() => {
    const update = () => {
      const frameWidth = Math.min(0.94 * window.innerWidth, (window.innerHeight - 144) * aspect)
      document.documentElement.style.setProperty(
        '--gt-capture-scale',
        String(frameWidth / window.innerWidth),
      )
      document.documentElement.style.setProperty('--gt-capture-height-ratio', String(1 / aspect))
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--gt-capture-scale')
      document.documentElement.style.removeProperty('--gt-capture-height-ratio')
    }
  }, [aspect])

  return null
}

/** Uses the same breakpoint as the site's mobile layout and locks that choice
 * while recording so the overlay, pointer bounds, and virtual viewport agree. */
function ResponsiveRecorder() {
  const { status } = useRecorder()
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_VIEWPORT).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(MOBILE_VIEWPORT)
    const update = () => {
      if (status === 'idle') setMobile(query.matches)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [status])

  const aspect = mobile ? MOBILE_ASPECT : DESKTOP_ASPECT

  return (
    <>
      <GTRecorder
        contentSelector=".layout"
        frame={mobile ? MOBILE_FRAME : '16:9'}
        expose="gtRecorder"
        harvest={harvest}
        labels={mobile ? MOBILE_LABELS : DESKTOP_LABELS}
        onComplete={handleRecordingComplete}
      />
      <CaptureScale aspect={aspect} />
    </>
  )
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
      // Preload every self-hosted latin face. This keeps the fallback interval
      // from font-display: swap short, including sans 500/600 interaction
      // states (active nav item and item names).
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
          <ResponsiveRecorder />
        </GTProvider>
        <Scripts />
      </body>
    </html>
  )
}
