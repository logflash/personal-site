export const PAGE_MEMORY_KEY = 'ian-site-page-memory-v1'

export interface ReadingPosition {
  y: number
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
  if (memory.language?.path === location.pathname) return memory.language.snapshot
  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
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
    anchor: anchor?.dataset.readingAnchor,
    offset: anchor?.getBoundingClientRect().top,
    graphX: document.querySelector<HTMLElement>('.cg-scroller')?.scrollLeft,
  }
}

export function rememberLanguagePosition(path: string) {
  pageMemory().language = { path, snapshot: captureSnapshot() }
  persistPageMemory()
}
