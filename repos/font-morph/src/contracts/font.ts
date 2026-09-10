export type FontMorphPoint = readonly [x: number, y: number]

export interface FontMorphBounds {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

export interface FontMorphFontInstance {
  id: string
  sha256: string
  faceIndex: number
  axes: Record<string, number>
}

export interface FontMorphShapedGlyph {
  unicode: string
  glyphId: number
  x: number
  y: number
  advanceWidth: number
}

export interface FontMorphCompiledRun {
  id: string
  text: string
  fontInstanceId: string
  language: string
  script: string
  direction: 'ltr' | 'rtl'
  features: Record<string, boolean>
  glyphs: FontMorphShapedGlyph[]
  advanceWidth: number
}
