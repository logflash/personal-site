import { configureFontMorph } from 'glyphflux'
import FontMorphOutlineWorker from '../../repos/glyphflux/src/outline.worker.ts?worker'
import {
  glyphfluxManifestByKey,
  glyphfluxManifestUrlsByText,
} from '../generated/glyphfluxManifests'
import { createPreparedGlyphfluxLoader } from './preparedGlyphflux'

const loadPreparedOutlines = createPreparedGlyphfluxLoader(
  glyphfluxManifestByKey,
  glyphfluxManifestUrlsByText,
)

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
