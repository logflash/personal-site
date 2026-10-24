export const PAGE_MEMORY_KEY = 'ian-site-page-memory-v1'

// Runs in <head>, before SSR content can paint. Hydration restores disclosures
// and filters; usePageMemory then measures the translated layout and reveals it.
// Fresh loads/reloads and blocked storage retain the normal SSR paint. If the
// client bundle fails to load, the watchdog still makes the document readable.
export const READING_RESTORE_BOOT_SCRIPT = `(()=>{try{const memory=JSON.parse(sessionStorage.getItem('${PAGE_MEMORY_KEY}')||'null');const navigation=performance.getEntriesByType('navigation')[0];if(navigation?.type!=='reload'&&memory?.language?.path===location.pathname&&Number.isFinite(memory.language.snapshot?.position?.y)){document.documentElement.dataset.initialReading='';history.scrollRestoration='manual';setTimeout(()=>document.documentElement.removeAttribute('data-initial-reading'),5000)}}catch{}})()`

export interface ReadingPosition {
  y: number
  atBottom?: boolean
  anchor?: string
  offset?: number
  graphX?: number
}

export interface ReadingSnapshot {
  position: ReadingPosition
  values: Record<string, string | boolean>
}

interface PageMemory {
  entries: Record<string, ReadingSnapshot>
  language?: { path: string; snapshot: ReadingSnapshot }
}

let cache: PageMemory | undefined
let activeValues: ReadingSnapshot['values'] = {}
export const RESTORE_VALUES_EVENT = 'site:restore-reading-values'
export const READING_LAYOUT_READY_EVENT = 'site:reading-layout-ready'

export function pageMemory(): PageMemory {
  if (cache) return cache
  try {
    const saved = JSON.parse(sessionStorage.getItem(PAGE_MEMORY_KEY) ?? 'null')
    if (saved?.entries) cache = saved
  } catch {
    // Storage can be disabled. Keep the same behavior within this document.
  }
  cache ??= { entries: {} }
  activeValues = { ...initialSnapshot()?.values }
  return cache
}

export function initialSnapshot() {
  const memory = cache ?? pageMemory()
  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  if (navigation?.type !== 'reload' && memory.language?.path === location.pathname)
    return memory.language.snapshot
  return navigation?.type === 'back_forward' ? memory.entries[history.state?.__TSR_key] : undefined
}

export function restoreValues(snapshot?: ReadingSnapshot) {
  activeValues = { ...snapshot?.values }
  document.dispatchEvent(new Event(RESTORE_VALUES_EVENT))
}

export function persistPageMemory() {
  try {
    const memory = pageMemory()
    // Bound history bookkeeping during long browsing sessions.
    memory.entries = Object.fromEntries(Object.entries(memory.entries).slice(-80))
    sessionStorage.setItem(PAGE_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // A full or unavailable session store must never prevent navigation.
  }
}

export function rememberValue(key: string, value: string | boolean) {
  pageMemory()
  activeValues[key] = value
}

export function readValue(key: string) {
  pageMemory()
  return activeValues[key]
}

export function captureSnapshot(): ReadingSnapshot {
  return { position: capturePosition(), values: { ...activeValues } }
}

export function capturePosition(): ReadingPosition {
  const anchors = [...document.querySelectorAll<HTMLElement>('main [data-reading-anchor]')].filter(
    (element) => element.getClientRects().length && element.getBoundingClientRect().bottom > 0,
  )
  // Prefer the entry crossing the reading line, including a long open entry.
  const anchor =
    anchors.filter((element) => element.getBoundingClientRect().top <= 100).at(-1) ?? anchors[0]
  return {
    y: window.scrollY,
    atBottom:
      window.scrollY > 0 &&
      document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= 2,
    anchor: anchor?.dataset.readingAnchor,
    offset: anchor?.getBoundingClientRect().top,
    graphX: document.querySelector<HTMLElement>('.cg-scroller')?.scrollLeft,
  }
}

export function rememberLanguagePosition(path: string) {
  pageMemory().language = { path, snapshot: captureSnapshot() }
  persistPageMemory()
}
