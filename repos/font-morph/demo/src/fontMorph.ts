import { configureFontMorph } from '../../src/index'
import FontMorphOutlineWorker from '../../src/outline.worker.ts?worker'

export function configureDemoFontMorph() {
  configureFontMorph({
    fontFiles: {
      sans: ['/fonts/ibm-plex-sans-400-outline.ttf', '/fonts/noto-sans-jp-400-outline.ttf'],
      serif: ['/fonts/source-serif-4-600-outline.ttf', '/fonts/noto-serif-jp-600-outline.ttf'],
    },
    resolveFontRole: (fontFamily) =>
      fontFamily
        .split(',')
        .some((family) => /^['"]?demo serif(?: jp)?['"]?$/i.test(family.trim()))
        ? 'serif'
        : 'sans',
    createWorker: () => new FontMorphOutlineWorker(),
  })
}
