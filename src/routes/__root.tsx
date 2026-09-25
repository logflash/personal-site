import { HeadContent, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { RecorderBundle } from 'gt-rrweb'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import fontMorphCssUrl from '../../repos/glyphflux/styles.css?url'
import { LazyReplayOverlay } from '../components/LazyReplayOverlay'
import { NotFoundPage } from '../components/NotFoundPage'
import {
  RecordingRuntimeContext,
  type RecordingRequest,
  type RecordingRuntimeControls,
  type RecordingRuntimeStatus,
} from '../hooks/useRecordingRuntime'
import { DEFAULT_LOCALE, localeFromPath } from '../lib/localePath'
import {
  CONTRIBUTION_SCROLL_CUE_STORAGE_KEY,
  INITIAL_RIGHT_REVEAL_PX,
} from '../lib/contributionGraphLayout'
import { requestBypassesCache } from '../lib/contributionSession'
import { TRUSTED_TYPES_BOOT_SCRIPT } from '../lib/security'
import { personStructuredData } from '../lib/seo'
import { TranslationProvider } from '../lib/i18n'
import loadTranslations from '../loadTranslations'
import fontsCssUrl from '../styles/fonts.css?url'
import globalCssUrl from '../styles/global.css?url'

type RecordingRuntimeComponent =
  (typeof import('../components/RecordingRuntime'))['RecordingRuntime']

// Applies client-only display state before CSS and the first paint. A fragment
// load must be instant; normal hash navigation becomes smooth after hydration.
// Touch mode stays latched because some phone browsers report hover capability
// even though finger taps leave :hover styles stuck on screen.
const DISPLAY_BOOT_SCRIPT = `try{if(localStorage.getItem('ian-site-theme')==='dark'){document.documentElement.dataset.theme='dark'}}catch(e){}addEventListener('touchstart',()=>document.documentElement.classList.add('touch'),{once:true,passive:true});const setActiveSection=()=>{const parts=location.pathname.split('/').filter(Boolean);let section=location.pathname.endsWith('/resume')?'resume':parts.length===1?'home':'not-found';try{section=decodeURIComponent(location.hash.slice(1))||section}catch(e){}document.documentElement.dataset.activeSection=section};setActiveSection();addEventListener('hashchange',setActiveSection);document.documentElement.dataset.initialScroll='';if(location.hash){document.documentElement.dataset.initialHash=''}`

// Runs synchronously after the server-rendered sections have been parsed but
// before the client bundle or first visible paint. It positions both scroll
// axes that have non-default starting points. If a future route stops
// rendering its anchor on the server, useDeepLinkScroll remains the fallback.
const INITIAL_LAYOUT_SCRIPT = `try{document.querySelectorAll('.cg-scroller').forEach((scroller)=>{const max=Math.max(0,scroller.scrollWidth-scroller.clientWidth);scroller.scrollLeft=Math.max(0,max-${INITIAL_RIGHT_REVEAL_PX})})}finally{document.documentElement.removeAttribute('data-initial-scroll')}if(document.documentElement.hasAttribute('data-initial-hash')){try{if(location.hash==='#home'){document.documentElement.removeAttribute('data-initial-hash')}else{const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(target){target.scrollIntoView({behavior:'instant'});document.documentElement.removeAttribute('data-initial-hash')}}}catch(e){document.documentElement.removeAttribute('data-initial-hash')}}`

const contributionCueShouldReset = createIsomorphicFn()
  .server(() => requestBypassesCache(getRequest()))
  .client(() => false)

const contributionCueBootScript = (reset: boolean) =>
  `try{if(${reset})sessionStorage.removeItem('${CONTRIBUTION_SCROLL_CUE_STORAGE_KEY}');if(sessionStorage.getItem('${CONTRIBUTION_SCROLL_CUE_STORAGE_KEY}')==='1')document.documentElement.dataset.contributionScrollCueDismissed=''}catch(e){}`

export const Route = createRootRoute({
  loader: async ({ location }) => {
    // The path prefix is the source of truth; the bare `/` route performs
    // cookie/header detection before redirecting here (routes/index.tsx).
    const locale = localeFromPath(location.pathname) ?? DEFAULT_LOCALE
    return {
      locale,
      translations: await loadTranslations(locale),
      resetContributionCue: contributionCueShouldReset(),
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/avatar.png' },
      // All three faces still start fetching from the document, preserving a
      // flicker-free warm refresh. Only the above-the-fold body face competes
      // at high priority; mono/serif and morph preparation remain eager but
      // cannot delay the LCP face or the hydration entry on a cold mobile link.
      ...[
        ['ibm-plex-sans-400-latin', 'high'],
        ['jetbrains-mono-400-latin', 'low'],
        ['source-serif-4-600-latin', 'low'],
      ].map(([font, fetchPriority]) => ({
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: `/fonts/${font}.woff2`,
        crossOrigin: 'anonymous' as const,
        fetchPriority,
      })),
      ...(loaderData?.locale === 'ja'
        ? [
            ['noto-sans-jp-400-subset.woff2', 'font/woff2'],
            ['noto-sans-jp-600-subset.woff2', 'font/woff2'],
            ['noto-serif-jp-600-subset.woff2', 'font/woff2'],
          ].map(([font, type]) => ({
            rel: 'preload',
            as: 'font',
            type,
            href: `/fonts/${font}`,
            crossOrigin: 'anonymous' as const,
          }))
        : []),
      // The locale-sized manifest replaces runtime OpenType parsing and KUTE
      // correspondence. Fetch it with the document so the first transition is
      // ready even when a user taps before the post-hydration idle callback.
      ...(loaderData?.locale
        ? [
            {
              rel: 'preload',
              as: 'fetch',
              type: 'application/json',
              href: `/glyphflux/${loaderData.locale}.json`,
              crossOrigin: 'anonymous' as const,
              fetchPriority: 'low',
            },
          ]
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
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const nonce = useRouter().options.ssr?.nonce
  const { locale, translations, resetContributionCue } = Route.useLoaderData()
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
        <script nonce={nonce}>{TRUSTED_TYPES_BOOT_SCRIPT}</script>
        <script nonce={nonce}>
          {contributionCueBootScript(resetContributionCue) + DISPLAY_BOOT_SCRIPT}
        </script>
        <script nonce={nonce} type="application/ld+json">
          {JSON.stringify(personStructuredData(locale))}
        </script>
        {import.meta.env.DEV ? null : <style nonce={nonce}>{__INLINE_CSS__}</style>}
        <HeadContent />
      </head>
      <body>
        <TranslationProvider locale={locale} translations={translations}>
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
        </TranslationProvider>
        <script nonce={nonce}>{INITIAL_LAYOUT_SCRIPT}</script>
        <Scripts />
      </body>
    </html>
  )
}
