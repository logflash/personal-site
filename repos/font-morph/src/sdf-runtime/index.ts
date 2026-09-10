import type { FontMorphSdfGlyphPair, FontMorphSdfWarpRegion } from '../contracts/sdf'

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function interpolate(source: number, target: number, progress: number) {
  return source + (target - source) * progress
}

function smoothstep(value: number) {
  const clamped = clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function sample(field: Uint8Array, size: number, x: number, y: number) {
  const clampedX = clamp(x, 0, size - 1)
  const clampedY = clamp(y, 0, size - 1)
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(size - 1, x0 + 1)
  const y1 = Math.min(size - 1, y0 + 1)
  const fractionX = clampedX - x0
  const fractionY = clampedY - y0
  const top = interpolate(field[y0 * size + x0], field[y0 * size + x1], fractionX)
  const bottom = interpolate(field[y1 * size + x0], field[y1 * size + x1], fractionX)
  return interpolate(top, bottom, fractionY)
}

function regionOffset(
  region: FontMorphSdfWarpRegion,
  x: number,
  y: number,
  progress: number,
  extent: number,
) {
  const centerX = interpolate(region.source.center[0], region.target.center[0], progress) * extent
  const centerY = interpolate(region.source.center[1], region.target.center[1], progress) * extent
  const radiusX = interpolate(region.source.radius[0], region.target.radius[0], progress) * extent
  const radiusY = interpolate(region.source.radius[1], region.target.radius[1], progress) * extent
  const weightX = 1 - smoothstep(Math.abs(x - centerX) / Math.max(Number.EPSILON, radiusX))
  const weightY = 1 - smoothstep(Math.abs(y - centerY) / Math.max(Number.EPSILON, radiusY))
  const weight = weightX * weightY
  return {
    weight,
    x: (region.target.center[0] - region.source.center[0]) * extent * weight,
    y: (region.target.center[1] - region.source.center[1]) * extent * weight,
  }
}

/**
 * Evaluates one precompiled distance-field glyph at an absolute progress value.
 * Structural matching is absent from this runtime; automatic local registration
 * has already been resolved deterministically during compilation.
 */
export function renderFontMorphSdfFrame(
  pair: FontMorphSdfGlyphPair,
  progress: number,
  output = new Float32Array(pair.size * pair.size),
) {
  const clampedProgress = clamp(progress, 0, 1)
  const expectedLength = pair.size * pair.size
  if (
    pair.source.distance.length !== expectedLength ||
    pair.target.distance.length !== expectedLength ||
    output.length !== expectedLength
  ) {
    throw new RangeError('font-morph distance-field buffers do not match the declared square size')
  }
  if (clampedProgress === 0) {
    output.set(pair.source.distance)
    return output
  }
  if (clampedProgress === 1) {
    output.set(pair.target.distance)
    return output
  }

  // With no structural registration, both sampling coordinates are the current
  // integer texel. Avoid two clamped bilinear samples per pixel—the result is
  // exactly the same linear distance interpolation with far less runtime work.
  if (pair.warpRegions.length === 0) {
    const source = pair.source.distance
    const target = pair.target.distance
    for (let index = 0; index < output.length; index += 1) {
      output[index] = interpolate(source[index], target[index], clampedProgress)
    }
    return output
  }

  const extent = pair.size - 1
  for (let index = 0; index < output.length; index += 1) {
    const x = index % pair.size
    const y = Math.floor(index / pair.size)
    let offsetX = 0
    let offsetY = 0
    let totalWeight = 0
    for (const region of pair.warpRegions) {
      const offset = regionOffset(region, x, y, clampedProgress, extent)
      offsetX += offset.x
      offsetY += offset.y
      totalWeight += offset.weight
    }
    if (totalWeight > 1) {
      offsetX /= totalWeight
      offsetY /= totalWeight
    }
    const source = sample(
      pair.source.distance,
      pair.size,
      x - clampedProgress * offsetX,
      y - clampedProgress * offsetY,
    )
    const target = sample(
      pair.target.distance,
      pair.size,
      x + (1 - clampedProgress) * offsetX,
      y + (1 - clampedProgress) * offsetY,
    )
    output[index] = interpolate(source, target, clampedProgress)
  }
  return output
}

export type {
  FontMorphSdfGlyphPair,
  FontMorphSdfWarpControl,
  FontMorphSdfWarpRegion,
} from '../contracts/sdf'
