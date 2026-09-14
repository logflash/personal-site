import type { FontMorphPreparedManifest } from 'glyphflux'
import { configureFontMorph } from 'glyphflux'
import FontMorphOutlineWorker from '../../repos/glyphflux/src/outline.worker.ts?worker'
import { glyphfluxLocaleByText } from '../generated/glyphfluxData'

const preparedManifestRequests = new Map<string, Promise<FontMorphPreparedManifest>>()

function loadPreparedOutlines(text: string) {
  const locale = glyphfluxLocaleByText[text]
  if (!locale) return undefined
  let pending = preparedManifestRequests.get(locale)
  if (!pending) {
    pending = fetch(`/glyphflux/${locale}.json`).then(async (response) => {
      if (!response.ok)
        throw new Error(`Unable to load prepared Glyphflux data: ${response.status}`)
      return (await response.json()) as FontMorphPreparedManifest
    })
    preparedManifestRequests.set(locale, pending)
  }
  return pending
}

configureFontMorph({
  fontFiles: {
    sans: ['/fonts/ibm-plex-sans-400-outline.ttf', '/fonts/noto-sans-jp-400-outline.ttf'],
    serif: ['/fonts/source-serif-4-600-outline.ttf', '/fonts/noto-serif-jp-600-outline.ttf'],
  },
  recordingClass: 'gt-recording',
  captureSelector: '.layout',
  transientClass: 'rr-block',
  resolveFontRole: (fontFamily) =>
    fontFamily.toLowerCase().includes('source serif') ||
    fontFamily.toLowerCase().includes('noto serif')
      ? 'serif'
      : 'sans',
  resolveTextIdentity: (element) => element.dataset._gtHash,
  loadPreparedOutlines,
  createWorker: () => new FontMorphOutlineWorker(),
})

export {
  FONT_MORPH_EVENT_TAG,
  FONT_MORPH_RECORD_EVENT,
  beginFontMorph,
  prepareFontMorph,
} from 'glyphflux'
