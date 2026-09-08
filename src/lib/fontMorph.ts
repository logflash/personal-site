import { configureFontMorph } from 'font-morph'

configureFontMorph({
  fontFiles: {
    sans: ['/fonts/ibm-plex-sans-400-outline.ttf', '/fonts/noto-sans-jp-400-outline.ttf'],
    serif: ['/fonts/source-serif-4-600-outline.ttf', '/fonts/noto-serif-jp-600-outline.ttf'],
  },
  recordingClass: 'gt-recording',
  captureSelector: '.layout',
  resolveFontRole: (fontFamily) =>
    fontFamily.toLowerCase().includes('source serif') ||
    fontFamily.toLowerCase().includes('noto serif')
      ? 'serif'
      : 'sans',
  resolveTextIdentity: (element) => element.dataset._gtHash,
})

export {
  FONT_MORPH_EVENT_TAG,
  FONT_MORPH_RECORD_EVENT,
  SETTLED_TEXT_HOLD_MS,
  beginFontMorph,
  createFontMorphReplayDirector,
  prepareFontMorph,
  prepareFontMorphReplay,
  reserveFontMorphSettledTextHolds,
} from 'font-morph'
