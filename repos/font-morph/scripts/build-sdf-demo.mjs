import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileSdfGlyphPairs,
  parseFontMorphFont,
  shapeFontMorphInstantiatedRun,
  stableStringify,
} from '../dist/compiler/index.mjs'

const started = performance.now()
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const outputFile = resolve(packageRoot, 'demo/public/generated/sdf.json')
const samples = {
  en: { label: 'English', text: 'Resume', language: 'en', sourceLabel: 'Sans serif', targetLabel: 'Serif', pair: 'latin' },
  es: { label: 'Español', text: 'Currículum', language: 'es', sourceLabel: 'Sans serif', targetLabel: 'Serif', pair: 'latin' },
  ja: { label: '日本語', text: '履歴書', language: 'ja', sourceLabel: 'Gothic', targetLabel: 'Mincho', pair: 'japanese' },
}
const pairFiles = {
  latin: [
    { file: 'ibm-plex-sans-400-outline.ttf', axes: { wght: 400 } },
    { file: 'source-serif-4-600-outline.ttf', axes: { opsz: 60 } },
  ],
  japanese: [
    { file: 'noto-sans-jp-400-outline.ttf' },
    { file: 'noto-serif-jp-600-outline.ttf' },
  ],
}
const overrideRoot = resolve(packageRoot, 'data/overrides/sdf/v1')
const landmarkOverrides = await Promise.all(
  (await readdir(overrideRoot))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(async (file) => JSON.parse(await readFile(resolve(overrideRoot, file), 'utf8'))),
)

const readFont = async ({ file, axes }) => {
  const bytes = await readFile(resolve(packageRoot, 'demo/public/fonts', file))
  return {
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ...(axes ? { axes } : {}),
  }
}
const pairs = {}
for (const [id, [sourceSpec, targetSpec]] of Object.entries(pairFiles)) {
  const source = await readFont(sourceSpec)
  const target = await readFont(targetSpec)
  const characters = [...new Set(
    Object.values(samples).filter((sample) => sample.pair === id).flatMap((sample) => [...sample.text]),
  )]
  const glyphs = compileSdfGlyphPairs(source, target, characters, {
    size: 256,
    pixelsPerEm: 1024,
    maximumDistance: 64,
    supersampling: 4,
    landmarkOverrides,
  })
  const sourceParsed = parseFontMorphFont(source)
  const targetParsed = parseFontMorphFont(target)
  pairs[id] = {
    sourceFontInstanceId: sourceParsed.instance.id,
    targetFontInstanceId: targetParsed.instance.id,
    glyphs: Object.fromEntries(glyphs.map((glyph) => [glyph.unicode, {
      ...glyph,
      source: {
        ...glyph.source,
        distanceBase64: Buffer.from(glyph.source.distance).toString('base64'),
        distance: undefined,
      },
      target: {
        ...glyph.target,
        distanceBase64: Buffer.from(glyph.target.distance).toString('base64'),
        distance: undefined,
      },
    }])),
  }
  for (const sample of Object.values(samples).filter((sample) => sample.pair === id)) {
    sample.sourceRun = shapeFontMorphInstantiatedRun(sourceParsed.outlineFont, {
      text: sample.text,
      fontInstanceId: sourceParsed.instance.id,
      language: sample.language,
    })
    sample.targetRun = shapeFontMorphInstantiatedRun(targetParsed.outlineFont, {
      text: sample.text,
      fontInstanceId: targetParsed.instance.id,
      language: sample.language,
    })
  }
}

await mkdir(resolve(outputFile, '..'), { recursive: true })
await writeFile(outputFile, `${stableStringify({
  version: 1,
  samples,
  pairs,
}, 2)}\n`)
console.log(`wrote distance-field demo data to ${outputFile} in ${(performance.now() - started).toFixed(1)}ms`)
