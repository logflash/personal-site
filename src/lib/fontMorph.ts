import type { FontMorphPreparedLoadRequest, FontMorphPreparedManifest } from 'glyphflux'
import { configureFontMorph } from 'glyphflux'
import FontMorphOutlineWorker from '../../repos/glyphflux/src/outline.worker.ts?worker'
import { glyphfluxLocaleByText } from '../generated/glyphfluxData'

const preparedManifestRequests = new Map<string, Promise<FontMorphPreparedManifest>>()

function loadPreparedOutlines(text: string, request?: FontMorphPreparedLoadRequest) {
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
    // A full-document locale switch can cancel the prefetch before a morph
    // awaits it. Handle that rejection immediately and permit a later retry;
    // callers still receive the original promise and its failure normally.
    void pending.catch(() => preparedManifestRequests.delete(locale))
  }
  // The download is shared, but only the requested font pair needs decoding.
  // Other weights/sizes remain available for a resize or a different endpoint.
  return pending.then((manifest): FontMorphPreparedManifest => {
    if (!request) return manifest
    const matches = ([key]: [string, unknown]) => key === request.key || key === request.reverseKey
    const outlines = Object.fromEntries(Object.entries(manifest.outlines).filter(matches))
    return manifest.version === 2
      ? {
          version: 2,
          outlines,
          sdfMorphs: Object.fromEntries(Object.entries(manifest.sdfMorphs).filter(matches)),
        }
      : { version: 1, outlines }
  })
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
