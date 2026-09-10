import type {
  FontMorphSdfEndpoint,
  FontMorphSdfGlyphPair,
  FontMorphSdfLandmark,
  FontMorphSdfLandmarkOverride,
  FontMorphSdfWarpRegion,
} from '../contracts/sdf'
import { compareStableText } from '../contracts/stableJson'
import { glyphDistanceField } from './distanceField'
import type { FontMorphFontInput } from './fontIdentity'
import { extractFontMorphInstantiatedGlyph } from './outline'
import { parseFontMorphFont, type ParsedFontMorphFont } from './fontParser'
import { rasterizeFontMorphGlyph, type FontMorphRaster } from './rasterize'

export interface FontMorphSdfCompileOptions {
  size?: number
  pixelsPerEm?: number
  maximumDistance?: number
  supersampling?: number
  /** Transparent field pixels retained around every glyph. */
  texturePadding?: number
  /** Reviewed font-to-canonical landmark mappings used only during compilation. */
  landmarkOverrides?: readonly FontMorphSdfLandmarkOverride[]
}

function validateLandmark(landmark: FontMorphSdfLandmark, path: string) {
  if (!landmark.manifoldId) throw new RangeError(`${path}.manifoldId must not be empty`)
  for (const [name, point] of [['center', landmark.center], ['radius', landmark.radius]] as const) {
    if (point.length !== 2 || point.some((value) => !Number.isFinite(value))) {
      throw new RangeError(`${path}.${name} must contain two finite coordinates`)
    }
  }
  if (landmark.center.some((value) => value < 0 || value > 1)) {
    throw new RangeError(`${path}.center must be normalized to [0, 1]`)
  }
  if (landmark.radius.some((value) => value <= 0 || value > 1)) {
    throw new RangeError(`${path}.radius must be normalized to (0, 1]`)
  }
}

function landmarkOverride(
  overrides: readonly FontMorphSdfLandmarkOverride[],
  parsed: ParsedFontMorphFont,
  unicode: string,
  glyphId: number,
) {
  const matches = overrides.filter(
    (override) => override.unicode === unicode && override.fontSha256 === parsed.instance.sha256,
  )
  if (matches.length > 1) {
    throw new RangeError(`duplicate distance-field landmark override for ${parsed.instance.sha256}/${unicode}`)
  }
  const override = matches[0]
  if (!override) return undefined
  if (override.version !== 1 || !override.canonicalVersion) {
    throw new RangeError(`invalid distance-field landmark override version for ${unicode}`)
  }
  if (override.glyphId !== glyphId) {
    throw new RangeError(`stale distance-field landmark override for ${parsed.instance.sha256}/${unicode}`)
  }
  const ids = new Set<string>()
  for (const [index, landmark] of override.landmarks.entries()) {
    validateLandmark(landmark, `landmarkOverrides.${unicode}.${index}`)
    if (ids.has(landmark.manifoldId)) {
      throw new RangeError(`duplicate manifold ${landmark.manifoldId} in landmark override for ${unicode}`)
    }
    ids.add(landmark.manifoldId)
  }
  return override
}

function compileWarpRegions(
  sourceParsed: ParsedFontMorphFont,
  targetParsed: ParsedFontMorphFont,
  source: FontMorphSdfEndpoint,
  target: FontMorphSdfEndpoint,
  unicode: string,
  overrides: readonly FontMorphSdfLandmarkOverride[],
  size: number,
  texturePadding: number,
): FontMorphSdfWarpRegion[] {
  const relevant = overrides.filter((override) => override.unicode === unicode)
  for (const override of relevant) {
    if (
      override.fontSha256 !== sourceParsed.instance.sha256 &&
      override.fontSha256 !== targetParsed.instance.sha256
    ) {
      throw new RangeError(`landmark override for ${unicode} does not match either compiled font`)
    }
  }
  const sourceOverride = landmarkOverride(relevant, sourceParsed, unicode, source.glyphId)
  const targetOverride = landmarkOverride(relevant, targetParsed, unicode, target.glyphId)
  if (!sourceOverride && !targetOverride) return []
  if (!sourceOverride || !targetOverride) {
    throw new RangeError(`distance-field landmarks for ${unicode} must map both fonts to canonical structure`)
  }
  if (sourceOverride.canonicalVersion !== targetOverride.canonicalVersion) {
    throw new RangeError(`distance-field landmarks for ${unicode} use different canonical versions`)
  }
  const sourceById = new Map(sourceOverride.landmarks.map((landmark) => [landmark.manifoldId, landmark]))
  const targetById = new Map(targetOverride.landmarks.map((landmark) => [landmark.manifoldId, landmark]))
  const sourceIds = [...sourceById.keys()].sort(compareStableText)
  const targetIds = [...targetById.keys()].sort(compareStableText)
  if (sourceIds.join('\0') !== targetIds.join('\0')) {
    throw new RangeError(`distance-field landmarks for ${unicode} do not share canonical manifold IDs`)
  }
  const paddedLandmark = (landmark: FontMorphSdfLandmark): FontMorphSdfLandmark => {
    const extent = size - 1
    const innerExtent = extent - texturePadding * 2
    const scale = innerExtent / extent
    return {
      ...landmark,
      center: [
        (texturePadding + landmark.center[0] * innerExtent) / extent,
        (texturePadding + landmark.center[1] * innerExtent) / extent,
      ],
      radius: [landmark.radius[0] * scale, landmark.radius[1] * scale],
    }
  }
  return sourceIds.map((manifoldId) => ({
    manifoldId,
    source: paddedLandmark(sourceById.get(manifoldId)!),
    target: paddedLandmark(targetById.get(manifoldId)!),
  }))
}

function fixedMask(
  raster: FontMorphRaster,
  size: number,
  supersampling: number,
  texturePadding: number,
) {
  const output = new Uint8Array(size * size)
  const innerSize = size - texturePadding * 2
  const sampleTotal = supersampling * supersampling
  for (let row = texturePadding; row < size - texturePadding; row += 1) {
    for (let column = texturePadding; column < size - texturePadding; column += 1) {
      let coverage = 0
      for (let sampleY = 0; sampleY < supersampling; sampleY += 1) {
        const y = (
          (row - texturePadding + (sampleY + 0.5) / supersampling) / innerSize
        ) * raster.height
        const sourceRow = Math.min(raster.height - 1, Math.floor(y))
        for (let sampleX = 0; sampleX < supersampling; sampleX += 1) {
          const x = (
            (column - texturePadding + (sampleX + 0.5) / supersampling) / innerSize
          ) * raster.width
          const sourceColumn = Math.min(raster.width - 1, Math.floor(x))
          coverage += raster.data[sourceRow * raster.width + sourceColumn]
        }
      }
      output[row * size + column] = coverage * 2 >= sampleTotal ? 1 : 0
    }
  }
  return output
}

function paddedBounds(raster: FontMorphRaster, size: number, texturePadding: number) {
  const innerSize = size - texturePadding * 2
  const xPadding = (raster.bounds.xMax - raster.bounds.xMin) * texturePadding / innerSize
  const yPadding = (raster.bounds.yMax - raster.bounds.yMin) * texturePadding / innerSize
  return {
    xMin: raster.bounds.xMin - xPadding,
    yMin: raster.bounds.yMin - yPadding,
    xMax: raster.bounds.xMax + xPadding,
    yMax: raster.bounds.yMax + yPadding,
  }
}

function encodedSignedDistance(data: Uint8Array, size: number, maximumDistance: number) {
  const raster: FontMorphRaster = {
    width: size,
    height: size,
    pixelsPerEm: size,
    bounds: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
    data,
  }
  const inside = glyphDistanceField(raster)
  const inverse = Uint8Array.from(data, (value) => (value ? 0 : 1))
  const outside = glyphDistanceField({ ...raster, data: inverse })
  const output = new Uint8Array(data.length)
  for (let index = 0; index < output.length; index += 1) {
    const signed = data[index] ? inside[index] : -outside[index]
    const normalized = Math.max(-1, Math.min(1, signed / maximumDistance))
    output[index] = Math.max(0, Math.min(255, Math.round(128 + normalized * 127)))
  }
  return output
}

function compileEndpoint(
  parsed: ParsedFontMorphFont,
  unicode: string,
  size: number,
  pixelsPerEm: number,
  maximumDistance: number,
  supersampling: number,
  texturePadding: number,
): FontMorphSdfEndpoint {
  const codePoints = [...unicode].map((character) => character.codePointAt(0)!)
  if (codePoints.length !== 1) {
    throw new RangeError('font-morph distance fields compile one Unicode character at a time')
  }
  const outline = extractFontMorphInstantiatedGlyph(
    parsed.outlineFont,
    codePoints[0],
    1 / pixelsPerEm,
  )
  const raster = rasterizeFontMorphGlyph(outline, pixelsPerEm)
  return {
    fontInstanceId: parsed.instance.id,
    glyphId: outline.glyphId,
    advanceWidth: outline.advanceWidth,
    textureBounds: paddedBounds(raster, size, texturePadding),
    distance: encodedSignedDistance(
      fixedMask(raster, size, supersampling, texturePadding),
      size,
      maximumDistance,
    ),
  }
}

export function compileSdfGlyphPair(
  source: FontMorphFontInput,
  target: FontMorphFontInput,
  unicode: string,
  options: FontMorphSdfCompileOptions = {},
): FontMorphSdfGlyphPair {
  return compileSdfGlyphPairs(source, target, [unicode], options)[0]
}

export function compileSdfGlyphPairs(
  source: FontMorphFontInput,
  target: FontMorphFontInput,
  characters: readonly string[],
  options: FontMorphSdfCompileOptions = {},
): FontMorphSdfGlyphPair[] {
  if (characters.some((unicode) => [...unicode].length !== 1)) {
    throw new RangeError('font-morph distance fields compile one Unicode character at a time')
  }
  const size = options.size ?? 256
  const pixelsPerEm = options.pixelsPerEm ?? 1024
  const maximumDistance = options.maximumDistance ?? 48
  const supersampling = options.supersampling ?? 4
  const texturePadding = options.texturePadding ?? Math.max(2, Math.ceil(size / 64))
  if (!Number.isSafeInteger(size) || size < 32 || size > 1024) {
    throw new RangeError('font-morph distance-field size must be an integer from 32 through 1024')
  }
  if (!Number.isSafeInteger(supersampling) || supersampling < 1 || supersampling > 8) {
    throw new RangeError('font-morph distance-field supersampling must be an integer from 1 through 8')
  }
  if (
    !Number.isSafeInteger(texturePadding) ||
    texturePadding < 1 ||
    texturePadding * 4 >= size
  ) {
    throw new RangeError('font-morph texture padding must be a positive integer below one quarter of field size')
  }
  if (!Number.isFinite(maximumDistance) || maximumDistance <= 0 || maximumDistance > 0xffff) {
    throw new RangeError('font-morph maximum distance must be positive')
  }
  const sourceParsed = parseFontMorphFont(source)
  const targetParsed = parseFontMorphFont(target)
  const landmarkOverrides = options.landmarkOverrides ?? []
  return [...new Set(characters)].sort().map((unicode) => {
    const sourceEndpoint = compileEndpoint(
      sourceParsed, unicode, size, pixelsPerEm, maximumDistance, supersampling, texturePadding,
    )
    const targetEndpoint = compileEndpoint(
      targetParsed, unicode, size, pixelsPerEm, maximumDistance, supersampling, texturePadding,
    )
    return {
      unicode,
      size,
      maximumDistance,
      warpRegions: compileWarpRegions(
        sourceParsed,
        targetParsed,
        sourceEndpoint,
        targetEndpoint,
        unicode,
        landmarkOverrides,
        size,
        texturePadding,
      ),
      source: sourceEndpoint,
      target: targetEndpoint,
    }
  })
}
