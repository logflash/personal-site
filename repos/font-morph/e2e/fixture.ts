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
      prepare: () => Promise<void>
      start: () => boolean
      moveDestination: () => void
      reverse: () => boolean
      prepareReplay: () => Promise<void>
      replayAt: (time: number) => { advanceTo: number } | undefined
      show: (role: 'sans' | 'serif') => void
      stopReplay: () => void
    }
  }
}

configureFontMorph({
  fontFiles: {
    sans: ['/sans.otf'],
    serif: ['/serif.otf'],
  },
  resolveFontRole: (family) => (family.includes('Fixture Serif') ? 'serif' : 'sans'),
})

const events: unknown[] = []
const replayEvents: FontMorphEvent[] = []
const replayDirector = createFontMorphReplayDirector()
window.addEventListener(FONT_MORPH_RECORD_EVENT, (event) => {
  const payload = (event as CustomEvent).detail
  events.push(payload)
  replayEvents.splice(0, replayEvents.length, {
    type: 5,
    timestamp: 1_000,
    data: { tag: FONT_MORPH_EVENT_TAG, payload },
  })
})

function endpoint(role: 'sans' | 'serif') {
  const element = document.createElement('span')
  element.dataset.fontMorph = 'sample'
  element.className = `endpoint ${role}`
  element.textContent = 'ee'
  return element
}

function swap(role: 'sans' | 'serif') {
  document.querySelector<HTMLElement>('[data-font-morph="sample"]')?.replaceWith(endpoint(role))
}

window.fontMorphFixture = {
  events,
  prepare: () => prepareFontMorph('sample'),
  start: () => {
    const started = beginFontMorph('sample')
    if (started) swap('serif')
    return started
  },
  moveDestination: () => {
    document.querySelector<HTMLElement>('[data-font-morph="sample"]')?.classList.add('moved')
  },
  reverse: () => {
    const started = beginFontMorph('sample')
    if (started) swap('sans')
    return started
  },
  prepareReplay: () =>
    prepareFontMorphReplay(replayEvents, ['en'], () => undefined, document),
  replayAt: (time) => replayDirector({ time, document, locale: 'en', events: replayEvents }),
  show: swap,
  stopReplay: () => replayDirector({ time: Number.NaN, document: null, events: replayEvents }),
}
