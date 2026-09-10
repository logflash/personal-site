import { createHash } from 'node:crypto'
import type { Font } from 'opentype.js'
import type { FontMorphCompiledRun, FontMorphShapedGlyph } from '../contracts/font'
import { stableStringify } from '../contracts/stableJson'
import { FontMorphCompilerError } from './error'
import type { FontMorphOutlineFont } from './fontParser'

export interface FontMorphShapeRequest {
  text: string
  fontInstanceId: string
  language?: string
  script?: string
  direction?: 'ltr' | 'rtl'
  features?: Record<string, boolean>
}

function stableFeatures(features: Record<string, boolean> | undefined) {
  return Object.fromEntries(
    Object.entries(features ?? {})
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([tag, enabled]) => {
        if (!/^[ -~]{4}$/u.test(tag) || typeof enabled !== 'boolean') {
          throw new FontMorphCompilerError(
            'UNSUPPORTED_SHAPING',
            `shape.features.${tag}`,
            'feature tags contain four ASCII characters and values must be boolean',
          )
        }
        return [tag, enabled]
      }),
  )
}

function defaultScript(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) ? 'Jpan' : 'Latn'
}

function validatedIdentity(request: FontMorphShapeRequest) {
  const direction = request.direction ?? 'ltr'
  if (direction !== 'ltr' || /\p{Mark}/u.test(request.text)) {
    throw new FontMorphCompilerError(
      'UNSUPPORTED_SHAPING',
      'shape.text',
      'version 0.1 supports precomposed left-to-right Latin and Japanese text',
    )
  }
  const features = stableFeatures(request.features)
  if (Object.values(features).some(Boolean)) {
    throw new FontMorphCompilerError(
      'UNSUPPORTED_SHAPING',
      'shape.features',
      'version 0.1 requires optional OpenType features to be disabled',
    )
  }

  return {
    text: request.text,
    fontInstanceId: request.fontInstanceId,
    language: request.language ?? 'und',
    script: request.script ?? defaultScript(request.text),
    direction,
    features,
  }
}

export function shapeFontMorphRun(font: Font, request: FontMorphShapeRequest): FontMorphCompiledRun {
  const identity = validatedIdentity(request)

  const unitsPerEm = font.unitsPerEm
  const glyphs: FontMorphShapedGlyph[] = []
  let x = 0
  let previous = null as ReturnType<Font['charToGlyph']> | null
  for (const unicode of request.text) {
    const glyph = font.charToGlyph(unicode)
    if (glyph.index === 0 && unicode !== '\0') {
      throw new FontMorphCompilerError(
        'UNSUPPORTED_SHAPING',
        'shape.text',
        `font does not contain ${JSON.stringify(unicode)}`,
      )
    }
    if (previous) x += font.getKerningValue(previous, glyph) / unitsPerEm
    const advanceWidth = (glyph.advanceWidth ?? unitsPerEm) / unitsPerEm
    glyphs.push({ unicode, glyphId: glyph.index, x, y: 0, advanceWidth })
    x += advanceWidth
    previous = glyph
  }

  return {
    id: `run-${createHash('sha256').update(stableStringify(identity)).digest('hex').slice(0, 16)}`,
    ...identity,
    glyphs,
    advanceWidth: x,
  }
}

/** Shapes with the same variation-aware engine that supplies compiled outlines. */
export function shapeFontMorphInstantiatedRun(
  font: FontMorphOutlineFont,
  request: FontMorphShapeRequest,
): FontMorphCompiledRun {
  const identity = validatedIdentity(request)
  const characters = [...request.text]
  const run = font.layout(request.text, {
    ...identity.features,
    clig: false,
    liga: false,
    rlig: false,
  })
  if (run.glyphs.length !== characters.length || run.positions.length !== characters.length) {
    throw new FontMorphCompilerError(
      'UNSUPPORTED_SHAPING',
      'shape.text',
      'version 0.1 requires one positioned glyph per Unicode character',
    )
  }
  const unitsPerEm = font.unitsPerEm
  const glyphs: FontMorphShapedGlyph[] = []
  let x = 0
  let y = 0
  for (let index = 0; index < characters.length; index += 1) {
    const glyph = run.glyphs[index]
    const position = run.positions[index]
    glyphs.push({
      unicode: characters[index],
      glyphId: glyph.id,
      x: (x + position.xOffset) / unitsPerEm,
      y: (y + position.yOffset) / unitsPerEm,
      advanceWidth: position.xAdvance / unitsPerEm,
    })
    x += position.xAdvance
    y += position.yAdvance
  }
  const advanceWidth = run.advanceWidth / unitsPerEm
  return {
    id: `run-${createHash('sha256').update(stableStringify(identity)).digest('hex').slice(0, 16)}`,
    ...identity,
    glyphs,
    advanceWidth,
  }
}
