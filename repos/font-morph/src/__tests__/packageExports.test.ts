import { describe, expect, it } from 'vitest'
import * as compiler from '../compiler'
import * as sdf from '../sdf-runtime'
import * as fontMorph from '../index'

describe('font-morph package entry', () => {
  it('exposes live morph and deterministic frame-rendering APIs', () => {
    expect(fontMorph.configureFontMorph).toBeTypeOf('function')
    expect(fontMorph.prepareFontMorph).toBeTypeOf('function')
    expect(fontMorph.beginFontMorph).toBeTypeOf('function')
    expect(fontMorph.prepareFontMorphFrames).toBeTypeOf('function')
    expect(fontMorph.createFontMorphFrameRenderer).toBeTypeOf('function')
    expect(fontMorph.createFontMorphCompiler).toBeTypeOf('function')
    expect(fontMorph.compileFontMorphManifest).toBeTypeOf('function')
    expect(fontMorph.fontMorphPreparedKey).toBeTypeOf('function')
  })

  it('exposes separate compiler and dependency-free SDF APIs', () => {
    expect(compiler.parseFontMorphFont).toBeTypeOf('function')
    expect(compiler.shapeFontMorphRun).toBeTypeOf('function')
    expect(compiler.compileSdfGlyphPair).toBeTypeOf('function')
    expect(sdf.renderFontMorphSdfFrame).toBeTypeOf('function')
  })
})
