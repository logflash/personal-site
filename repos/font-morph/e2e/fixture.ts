import {
  FONT_MORPH_EVENT_TAG,
  FONT_MORPH_RECORD_EVENT,
  beginFontMorph,
  configureFontMorph,
  createFontMorphReplayDirector,
  prepareFontMorph,
  prepareFontMorphReplay,
  type FontMorphEvent,
} from '../dist/index.mjs'

declare global {
  interface Window {
    fontMorphFixture: {
      events: unknown[]
      workerRequests: unknown[]
      prepare: () => Promise<void>
      prepareUnknown: () => Promise<void>
      begin: () => boolean
      simulateBrowserTextScaling: () => void
      moveDestination: () => void
      reverse: () => boolean
      prepareReplay: () => Promise<void>
      replayAt: (time: number) => { advanceTo: number } | undefined
      show: (role: 'sans' | 'serif') => void
      stopReplay: () => void
    }
  }
}

const workerRequests: unknown[] = []

configureFontMorph({
  fontFiles: {
    sans: ['/sans-outline.otf'],
    serif: ['/serif-outline.otf'],
  },
  loadPreparedOutlines: () =>
    fetch('/prepared.json').then((response) => response.json()),
  createWorker: () => {
    const worker = new Worker('/outline-worker.js', { type: 'module' })
    const postMessage = worker.postMessage.bind(worker)
    worker.postMessage = ((message: unknown) => {
      workerRequests.push(message)
      postMessage(message)
    }) as typeof worker.postMessage
    return worker
  },
  resolveFontRole: (family) => (family.includes('Fixture Serif') ? 'serif' : 'sans'),
})

const events: unknown[] = []
const replayEvents: FontMorphEvent[] = []
const replayDirector = createFontMorphReplayDirector()
window.addEventListener(FONT_MORPH_RECORD_EVENT, (event) => {
  const payload = (event as CustomEvent).detail
  events.push(payload)
  replayEvents.splice(
    0,
    replayEvents.length,
    {
      type: 4,
      timestamp: 999,
      data: { width: window.innerWidth, height: window.innerHeight },
    },
    {
      type: 5,
      timestamp: 1_000,
      data: { tag: FONT_MORPH_EVENT_TAG, payload },
    },
  )
})

function endpoint(role: 'sans' | 'serif', content = 'ee') {
  const element = document.createElement('span')
  element.dataset.fontMorph = 'sample'
  element.className = `endpoint ${role}`
  element.textContent = content
  return element
}

function swap(role: 'sans' | 'serif') {
  document.querySelector<HTMLElement>('[data-font-morph="sample"]')?.replaceWith(endpoint(role))
}

window.fontMorphFixture = {
  events,
  workerRequests,
  prepare: () => prepareFontMorph('sample'),
  prepareUnknown: async () => {
    document.querySelector<HTMLElement>('[data-font-morph="sample"]')?.replaceWith(
      endpoint('sans', 'e'),
    )
    await prepareFontMorph('sample')
  },
  begin: () => beginFontMorph('sample'),
  simulateBrowserTextScaling: () => {
    document.documentElement.classList.add('simulated-mobile-text-scaling')
  },
  moveDestination: () => {
    document.querySelector<HTMLElement>('[data-font-morph="sample"]')?.classList.add('moved')
  },
  reverse: () => {
    const started = beginFontMorph('sample')
    if (started) swap('sans')
    return started
  },
  prepareReplay: () => {
    // rrweb stores normalized subpixel boxes; reconstructing their font size
    // can differ from the authored CSS value by a few thousandths. Prepared
    // outline identity must tolerate that harmless recording roundoff.
    const payload = replayEvents.find(
      (event) => event.type === 5 && event.data.tag === FONT_MORPH_EVENT_TAG,
    )?.data.payload
    const serifEndpoint = payload?.source.style.fontRole === 'serif' ? payload.source : payload?.target
    if (serifEndpoint) serifEndpoint.style.fontSizeToHeight *= 1.00004
    return prepareFontMorphReplay(replayEvents, ['en'], () => undefined, document)
  },
  replayAt: (time) => replayDirector({ time, document, locale: 'en', events: replayEvents }),
  show: swap,
  stopReplay: () => replayDirector({ time: Number.NaN, document: null, events: replayEvents }),
}
