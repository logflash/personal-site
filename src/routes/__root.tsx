import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { RecorderBundle } from 'gt-rrweb'
import { useCallback, useMemo, useRef, useState } from 'react'
import { GTProvider, getLocale, getTranslationsSnapshot } from 'gt-tanstack-start'
import type { ReactNode } from 'react'
import fontMorphCssUrl from '../../repos/font-morph/styles.css?url'
import { LazyReplayOverlay } from '../components/LazyReplayOverlay'
import {
  RecordingRuntimeContext,
  type RecordingRequest,
  type RecordingRuntimeControls,
  type RecordingRuntimeStatus,
} from '../hooks/useRecordingRuntime'
import { DEFAULT_LOCALE, localeFromPath } from '../lib/localePath'
import fontsCssUrl from '../styles/fonts.css?url'
import globalCssUrl from '../styles/global.css?url'

type RecordingRuntimeComponent =
  (typeof import('../components/RecordingRuntime'))['RecordingRuntime']

// Applies client-only display state before CSS and the first paint. A fragment
// load must be instant; normal hash navigation becomes smooth after hydration.
// Touch mode stays latched because some phone browsers report hover capability
// even though finger taps leave :hover styles stuck on screen.
const DISPLAY_BOOT_SCRIPT = `try{if(localStorage.getItem('ian-site-theme')==='dark'){document.documentElement.dataset.theme='dark'}}catch(e){}addEventListener('touchstart',()=>document.documentElement.classList.add('touch'),{once:true,passive:true});const setActiveSection=()=>{let section=location.pathname.endsWith('/resume')?'resume':'home';try{section=decodeURIComponent(location.hash.slice(1))||section}catch(e){}document.documentElement.dataset.activeSection=section};setActiveSection();addEventListener('hashchange',setActiveSection);document.documentElement.dataset.initialScroll='';if(location.hash){document.documentElement.dataset.initialHash=''}`

// Runs synchronously after the server-rendered sections have been parsed but
// before the client bundle or first visible paint. It positions both scroll
// axes that have non-default starting points. If a future route stops
// rendering its anchor on the server, useDeepLinkScroll remains the fallback.
const INITIAL_LAYOUT_SCRIPT = `try{document.querySelectorAll('.cg-scroller').forEach((scroller)=>{scroller.scrollLeft=scroller.scrollWidth})}finally{document.documentElement.removeAttribute('data-initial-scroll')}if(document.documentElement.hasAttribute('data-initial-hash')){try{if(location.hash==='#home'){document.documentElement.removeAttribute('data-initial-hash')}else{const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(target){target.scrollIntoView({behavior:'instant'});document.documentElement.removeAttribute('data-initial-hash')}}}catch(e){document.documentElement.removeAttribute('data-initial-hash')}}`

export const Route = createRootRoute({
  loader: async ({ location }) => {
    // The path prefix is the source of truth; gtMiddleware's cookie/header
    // detection only decides where the bare `/` redirects (routes/index.tsx).
    const locale = localeFromPath(location.pathname) ?? getLocale() ?? DEFAULT_LOCALE
    return { locale, translations: await getTranslationsSnapshot(locale) }
  },
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/avatar.png' },
      // Preload every self-hosted latin font file. IBM Plex Sans is one shared
      // variable resource for all four declared weights, so one preload warms
      // every sans face without four copies competing on a cold visit.
      ...['ibm-plex-sans-400-latin', 'jetbrains-mono-400-latin', 'source-serif-4-600-latin'].map(
        (font) => ({
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: `/fonts/${font}.woff2`,
          crossOrigin: 'anonymous' as const,
        }),
      ),
      ...(loaderData?.locale === 'ja'
        ? ['noto-sans-jp-400-outline', 'noto-serif-jp-600-outline'].map((font) => ({
            rel: 'preload',
            as: 'font',
            type: 'font/ttf',
            href: `/fonts/${font}.ttf`,
            crossOrigin: 'anonymous' as const,
          }))
        : []),
      // Dev only: linked stylesheets keep CSS editing live; production
      // inlines the CSS below to remove the only render-blocking requests.
      ...(import.meta.env.DEV
        ? [
            { rel: 'stylesheet', href: fontsCssUrl },
            { rel: 'stylesheet', href: fontMorphCssUrl },
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
  const [replay, setReplay] = useState<RecorderBundle | null>(null)
  const [runtime, setRuntime] = useState<RecordingRuntimeComponent | null>(null)
  const [recorderStatus, setRecorderStatus] = useState<RecordingRuntimeStatus>('idle')
  const [recordingRequest, setRecordingRequest] = useState<RecordingRequest | null>(null)
  const runtimeRef = useRef<RecordingRuntimeComponent | null>(null)
  const runtimeLoadRef = useRef<Promise<void> | null>(null)
  const nextRequestId = useRef(0)

  // Start fetching on pointer-down so the one-second hold normally hides the
  // network cost. A completed hold remains queued if the chunk is still loading.
  const prepareRecorder = useCallback(() => {
    if (runtimeRef.current || runtimeLoadRef.current) return
    setRecorderStatus('loading')
    runtimeLoadRef.current = import('../components/RecordingRuntime')
      .then(({ RecordingRuntime }) => {
        runtimeRef.current = RecordingRuntime
        setRuntime(() => RecordingRuntime)
      })
      .catch((error: unknown) => {
        runtimeLoadRef.current = null
        setRecorderStatus('idle')
        console.error('Unable to load the recording runtime', error)
      })
  }, [])

  const startRecording = useCallback(
    (locales: string[]) => {
      prepareRecorder()
      setRecorderStatus('preparing')
      setRecordingRequest({ id: ++nextRequestId.current, locales })
    },
    [prepareRecorder],
  )

  const recorderControls = useMemo<RecordingRuntimeControls>(
    () => ({ status: recorderStatus, prepare: prepareRecorder, start: startRecording }),
    [prepareRecorder, recorderStatus, startRecording],
  )
  const RecordingRuntime = runtime

  return (
    // suppressHydrationWarning: the theme script may set data-theme pre-hydration
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <GTProvider locale={locale} translations={translations}>
          <RecordingRuntimeContext.Provider value={recorderControls}>
            {children}
            {RecordingRuntime ? (
              <RecordingRuntime
                request={recordingRequest}
                onStatusChange={setRecorderStatus}
                onComplete={setReplay}
              />
            ) : null}
            {replay ? (
              <LazyReplayOverlay
                bundle={replay}
                initialLocale={locale}
                onClose={() => setReplay(null)}
              />
            ) : null}
          </RecordingRuntimeContext.Provider>
        </GTProvider>
        <script dangerouslySetInnerHTML={{ __html: INITIAL_LAYOUT_SCRIPT }} />
        <Scripts />
      </body>
    </html>
  )
}
