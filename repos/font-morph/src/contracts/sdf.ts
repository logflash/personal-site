import type { FontMorphBounds, FontMorphPoint } from './font'

/**
 * A reviewed, font-local placement of one canonical glyph manifold. Override
 * coordinates use the unpadded glyph field's top-left origin and are normalized
 * to [0, 1]; the compiler maps them into the emitted padded distance texture.
 */
export interface FontMorphSdfLandmark {
  manifoldId: string
  center: FontMorphPoint
  radius: FontMorphPoint
}

/**
 * Build input for an ambiguous glyph. Each font maps independently onto the
 * canonical manifold IDs; a font pair is never directly special-cased.
 */
export interface FontMorphSdfLandmarkOverride {
  version: 1
  canonicalVersion: string
  fontSha256: string
  unicode: string
  glyphId: number
  landmarks: FontMorphSdfLandmark[]
}

export interface FontMorphSdfWarpRegion {
  manifoldId: string
  source: FontMorphSdfLandmark
  target: FontMorphSdfLandmark
}

export interface FontMorphSdfEndpoint {
  fontInstanceId: string
  glyphId: number
  advanceWidth: number
  /** Bounds represented by the square distance grid, in em-relative units. */
  textureBounds: FontMorphBounds
  /** Signed distance encoded around 128; values above 128 are inside the glyph. */
  distance: Uint8Array
}

export interface FontMorphSdfGlyphPair {
  unicode: string
  size: number
  maximumDistance: number
  /** Build-resolved structural correspondence; runtime performs no matching. */
  warpRegions: FontMorphSdfWarpRegion[]
  source: FontMorphSdfEndpoint
  target: FontMorphSdfEndpoint
}

export interface FontMorphSerializedSdfEndpoint extends Omit<FontMorphSdfEndpoint, 'distance'> {
  distanceBase64: string
}

export interface FontMorphSerializedSdfGlyphPair
  extends Omit<FontMorphSdfGlyphPair, 'source' | 'target'> {
  source: FontMorphSerializedSdfEndpoint
  target: FontMorphSerializedSdfEndpoint
}
