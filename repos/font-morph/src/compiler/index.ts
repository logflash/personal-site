export { FontMorphCompilerError, type FontMorphCompilerDiagnosticCode } from './error'
export { createFontInstance, hashFontBytes, type FontMorphFontInput } from './fontIdentity'
export { parseFontMorphFont, type ParsedFontMorphFont } from './fontParser'
export {
  classifyOutlineContours,
  extractFontMorphGlyph,
  extractFontMorphInstantiatedGlyph,
  flattenPath,
  signedPolygonArea,
  type FontMorphExtractedGlyph,
  type FontMorphOutlineContour,
} from './outline'
export { glyphDistanceField } from './distanceField'
export { compileSdfGlyphPair, compileSdfGlyphPairs, type FontMorphSdfCompileOptions } from './sdf'
export { rasterizeFontMorphGlyph, rasterPixelPoint, type FontMorphRaster } from './rasterize'
export {
  shapeFontMorphInstantiatedRun,
  shapeFontMorphRun,
  type FontMorphShapeRequest,
} from './shaping'
export type {
  FontMorphBounds,
  FontMorphCompiledRun,
  FontMorphFontInstance,
  FontMorphPoint,
  FontMorphShapedGlyph,
} from '../contracts/font'
export type {
  FontMorphSdfEndpoint,
  FontMorphSdfGlyphPair,
  FontMorphSerializedSdfEndpoint,
  FontMorphSerializedSdfGlyphPair,
  FontMorphSdfWarpControl,
  FontMorphSdfWarpRegion,
} from '../contracts/sdf'
export { stableStringify } from '../contracts/stableJson'
