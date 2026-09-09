import { describe, expect, it } from 'vitest'
import * as fontMorph from '../index'

describe('font-morph package entry', () => {
  it('exposes live morph and deterministic replay APIs', () => {
    expect(fontMorph.configureFontMorph).toBeTypeOf('function')
    expect(fontMorph.prepareFontMorph).toBeTypeOf('function')
    expect(fontMorph.beginFontMorph).toBeTypeOf('function')
    expect(fontMorph.prepareFontMorphReplay).toBeTypeOf('function')
    expect(fontMorph.createFontMorphReplayDirector).toBeTypeOf('function')
    expect(fontMorph.createFontMorphCompiler).toBeTypeOf('function')
    expect(fontMorph.compileFontMorphManifest).toBeTypeOf('function')
  })
})
