import { describe, expect, it } from 'vitest'
import * as compiler from '../compiler'
import * as build from '../build'
import * as sdf from '../sdf-runtime'
import * as fontMorph from '../index'

describe('Glyphflux package entry', () => {
  it('exposes live morph and deterministic frame-rendering APIs', () => {
    expect(fontMorph.configureFontMorph).toBeTypeOf('function')
    expect(fontMorph.prepareFontMorph).toBeTypeOf('function')
    expect(fontMorph.beginFontMorph).toBeTypeOf('function')
    expect(fontMorph.createFontMorphProgressController).toBeTypeOf('function')
    expect(fontMorph.prepareFontMorphFrames).toBeTypeOf('function')
    expect(fontMorph.createFontMorphFrameRenderer).toBeTypeOf('function')
    expect(fontMorph.createFontMorphCompiler).toBeTypeOf('function')
    expect(fontMorph.compileFontMorphManifest).toBeTypeOf('function')
    expect(fontMorph.fontMorphPreparedKey).toBeTypeOf('function')
    expect(fontMorph.DEFAULT_FONT_MORPH_DURATION_MS).toBe(760)
    expect(fontMorph.FONT_MORPH_ENDPOINT_HANDOFF_MS).toBe(0)
    expect(fontMorph.endpointHandoffOpacities).toBeTypeOf('function')
  })

  it('exposes separate compiler and dependency-free SDF APIs', () => {
    expect(compiler.parseFontMorphFont).toBeTypeOf('function')
    expect(compiler.shapeFontMorphRun).toBeTypeOf('function')
    expect(compiler.compileSdfGlyphPair).toBeTypeOf('function')
    expect(compiler.createSdfTextMorphCompiler).toBeTypeOf('function')
    expect(sdf.renderFontMorphSdfFrame).toBeTypeOf('function')
    expect(sdf.renderFontMorphSdfAlphaFrame).toBeTypeOf('function')
  })

  it('exposes the build configuration and compiler pipeline separately', () => {
    expect(build.validateGlyphfluxConfig).toBeTypeOf('function')
    expect(build.discoverGlyphfluxText).toBeTypeOf('function')
    expect(build.buildGlyphflux).toBeTypeOf('function')
  })
})
