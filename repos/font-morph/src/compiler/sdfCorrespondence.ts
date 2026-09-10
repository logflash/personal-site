import type {
  FontMorphSdfGlyphPair,
  FontMorphSdfWarpControl,
  FontMorphSdfWarpRegion,
} from '../contracts/sdf'
import { renderFontMorphSdfFrame } from '../sdf-runtime'

const VALIDATION_PROGRESS = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] as const
const MAX_WARP_REGIONS = 3

interface TopologySignature {
  components: number
  holes: number
}

interface TopologyRange {
  source: TopologySignature
  target: TopologySignature
}

interface StrokeBand {
  orientation: 'horizontal' | 'vertical'
  axisStart: number
  axisEnd: number
  crossStart: number
  crossEnd: number
  ink: number
}

interface PixelRegion {
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface TransientAnomaly extends PixelRegion {
  kind: 'component' | 'hole'
  progress: number
}

function minimumStructuralArea(size: number) {
  // The SDF texture is an intermediate representation, not the output pixel
  // grid. Ignore islands smaller than roughly 1/64 em in each dimension so
  // threshold rounding cannot masquerade as a new stroke or counter.
  return Math.max(2, Math.floor((size * size) / 4096))
}

function floodRegion(
  field: ArrayLike<number>,
  size: number,
  start: number,
  ink: boolean,
  visited: Uint8Array,
) {
  const queue = [start]
  visited[start] = 1
  let area = 0
  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  while (queue.length) {
    const index = queue.pop()!
    area += 1
    const x = index % size
    const y = Math.floor(index / size)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    const visit = (neighbor: number) => {
      if (visited[neighbor] || field[neighbor] > 128 !== ink) return
      visited[neighbor] = 1
      queue.push(neighbor)
    }
    if (x > 0) visit(index - 1)
    if (x + 1 < size) visit(index + 1)
    if (index >= size) visit(index - size)
    if (index + size < field.length) visit(index + size)
  }
  return { area, minX, minY, maxX, maxY }
}

function topologySignature(field: ArrayLike<number>, size: number): TopologySignature {
  const minimumArea = minimumStructuralArea(size)
  const visitedInk = new Uint8Array(field.length)
  let components = 0
  for (let start = 0; start < field.length; start += 1) {
    if (visitedInk[start] || field[start] <= 128) continue
    if (floodRegion(field, size, start, true, visitedInk).area >= minimumArea) components += 1
  }

  const visitedBackground = new Uint8Array(field.length)
  const enqueueBackground = (index: number) => {
    if (visitedBackground[index] || field[index] > 128) return
    floodRegion(field, size, index, false, visitedBackground)
  }
  for (let coordinate = 0; coordinate < size; coordinate += 1) {
    enqueueBackground(coordinate)
    enqueueBackground((size - 1) * size + coordinate)
    enqueueBackground(coordinate * size)
    enqueueBackground(coordinate * size + size - 1)
  }
  let holes = 0
  for (let start = 0; start < field.length; start += 1) {
    if (visitedBackground[start] || field[start] > 128) continue
    if (floodRegion(field, size, start, false, visitedBackground).area >= minimumArea) holes += 1
  }
  return { components, holes }
}

function structuralRegions(field: ArrayLike<number>, size: number, ink: boolean) {
  const minimumArea = minimumStructuralArea(size)
  const visited = new Uint8Array(field.length)
  if (!ink) {
    const visitExterior = (index: number) => {
      if (!visited[index] && field[index] <= 128) {
        floodRegion(field, size, index, false, visited)
      }
    }
    for (let coordinate = 0; coordinate < size; coordinate += 1) {
      visitExterior(coordinate)
      visitExterior((size - 1) * size + coordinate)
      visitExterior(coordinate * size)
      visitExterior(coordinate * size + size - 1)
    }
  }
  const regions: PixelRegion[] = []
  for (let start = 0; start < field.length; start += 1) {
    if (visited[start] || field[start] > 128 !== ink) continue
    const region = floodRegion(field, size, start, ink, visited)
    if (region.area >= minimumArea) regions.push(region)
  }
  return regions.sort(
    (left, right) => left.area - right.area || left.minY - right.minY || left.minX - right.minX,
  )
}

function outsideRange(value: number, left: number, right: number) {
  const minimum = Math.min(left, right)
  const maximum = Math.max(left, right)
  return value < minimum ? minimum - value : value > maximum ? value - maximum : 0
}

function topologyPenalty(
  pair: FontMorphSdfGlyphPair,
  regions: FontMorphSdfWarpRegion[],
  range: TopologyRange,
) {
  const candidate = { ...pair, warpRegions: regions }
  let penalty = 0
  for (const progress of VALIDATION_PROGRESS) {
    const signature = topologySignature(renderFontMorphSdfFrame(candidate, progress), pair.size)
    penalty += outsideRange(signature.components, range.source.components, range.target.components)
    penalty += outsideRange(signature.holes, range.source.holes, range.target.holes)
  }
  return penalty
}

function longestInkRun(
  field: Uint8Array,
  size: number,
  axis: number,
  orientation: StrokeBand['orientation'],
) {
  let bestStart = -1
  let bestEnd = -1
  let runStart = -1
  for (let cross = 0; cross <= size; cross += 1) {
    const index =
      cross < size ? (orientation === 'horizontal' ? axis * size + cross : cross * size + axis) : -1
    if (index >= 0 && field[index] > 128) {
      if (runStart < 0) runStart = cross
    } else if (runStart >= 0) {
      if (cross - runStart > bestEnd - bestStart + 1) {
        bestStart = runStart
        bestEnd = cross - 1
      }
      runStart = -1
    }
  }
  return { start: bestStart, end: bestEnd, length: bestEnd - bestStart + 1 }
}

function strokeBands(field: Uint8Array, size: number, orientation: StrokeBand['orientation']) {
  const minimumRun = Math.max(4, Math.floor(size * 0.28))
  const rows = Array.from({ length: size }, (_, axis) => ({
    axis,
    ...longestInkRun(field, size, axis, orientation),
  })).filter(({ length }) => length >= minimumRun)
  const bands: StrokeBand[] = []
  for (const row of rows) {
    const previous = bands.at(-1)
    const overlap = previous
      ? Math.max(
          0,
          Math.min(previous.crossEnd, row.end) - Math.max(previous.crossStart, row.start) + 1,
        )
      : 0
    const shared = previous
      ? overlap / Math.max(1, Math.min(previous.crossEnd - previous.crossStart + 1, row.length))
      : 0
    if (previous && row.axis === previous.axisEnd + 1 && shared >= 0.5) {
      previous.axisEnd = row.axis
      previous.crossStart = Math.min(previous.crossStart, row.start)
      previous.crossEnd = Math.max(previous.crossEnd, row.end)
      previous.ink += row.length
    } else {
      bands.push({
        orientation,
        axisStart: row.axis,
        axisEnd: row.axis,
        crossStart: row.start,
        crossEnd: row.end,
        ink: row.length,
      })
    }
  }
  return bands.filter((band) => {
    const thickness = band.axisEnd - band.axisStart + 1
    return thickness <= size * 0.24 && band.ink >= minimumRun * 2
  })
}

function bandCenter(band: StrokeBand) {
  const axis = (band.axisStart + band.axisEnd) / 2
  const cross = (band.crossStart + band.crossEnd) / 2
  return band.orientation === 'horizontal' ? ([cross, axis] as const) : ([axis, cross] as const)
}

function bandLength(band: StrokeBand) {
  return band.crossEnd - band.crossStart + 1
}

function bandThickness(band: StrokeBand) {
  return band.axisEnd - band.axisStart + 1
}

function candidateRegion(
  source: StrokeBand,
  target: StrokeBand,
  size: number,
  index: number,
): FontMorphSdfWarpRegion {
  const extent = size - 1
  const sourceCenter = bandCenter(source)
  const targetCenter = bandCenter(target)
  const deltaX = Math.abs(targetCenter[0] - sourceCenter[0])
  const deltaY = Math.abs(targetCenter[1] - sourceCenter[1])
  const padding = size * 0.025
  const radius = (band: StrokeBand): readonly [number, number] => {
    const crossRadius = bandLength(band) / 2 + padding
    const axisDelta = band.orientation === 'horizontal' ? deltaY : deltaX
    const axisRadius = Math.max(size * 0.06, bandThickness(band) / 2 + axisDelta * 1.6 + padding)
    return band.orientation === 'horizontal'
      ? [Math.min(extent, crossRadius) / extent, Math.min(extent, axisRadius) / extent]
      : [Math.min(extent, axisRadius) / extent, Math.min(extent, crossRadius) / extent]
  }
  const control = (
    center: readonly [number, number],
    band: StrokeBand,
  ): FontMorphSdfWarpControl => ({
    center: [center[0] / extent, center[1] / extent],
    radius: radius(band),
  })
  return {
    id: `auto-${source.orientation}-${index}`,
    source: control(sourceCenter, source),
    target: control(targetCenter, target),
  }
}

function registrationCandidates(pair: FontMorphSdfGlyphPair) {
  const candidates: { region: FontMorphSdfWarpRegion; cost: number }[] = []
  for (const orientation of ['horizontal', 'vertical'] as const) {
    const sourceBands = strokeBands(pair.source.distance, pair.size, orientation)
    const targetBands = strokeBands(pair.target.distance, pair.size, orientation)
    for (const [sourceIndex, source] of sourceBands.entries()) {
      for (const [targetIndex, target] of targetBands.entries()) {
        const sourceCenter = bandCenter(source)
        const targetCenter = bandCenter(target)
        const sourceLength = bandLength(source)
        const targetLength = bandLength(target)
        const lengthRatio =
          Math.max(sourceLength, targetLength) / Math.max(1, Math.min(sourceLength, targetLength))
        const crossDifference =
          Math.abs(
            sourceCenter[orientation === 'horizontal' ? 0 : 1] -
              targetCenter[orientation === 'horizontal' ? 0 : 1],
          ) / pair.size
        if (lengthRatio > 1.9 || crossDifference > 0.25) continue
        const axisDifference =
          Math.abs(
            sourceCenter[orientation === 'horizontal' ? 1 : 0] -
              targetCenter[orientation === 'horizontal' ? 1 : 0],
          ) / pair.size
        const rankDifference = Math.abs(
          sourceIndex / Math.max(1, sourceBands.length - 1) -
            targetIndex / Math.max(1, targetBands.length - 1),
        )
        const cost =
          axisDifference + crossDifference * 2 + Math.abs(Math.log(lengthRatio)) + rankDifference
        candidates.push({
          region: candidateRegion(source, target, pair.size, candidates.length),
          cost,
        })
      }
    }
  }
  return candidates
    .sort((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost
      return left.region.id < right.region.id ? -1 : left.region.id > right.region.id ? 1 : 0
    })
    .slice(0, 12)
    .map(({ region }, index) => ({ ...region, id: `auto-${String(index).padStart(2, '0')}` }))
}

function transientAnomalies(pair: FontMorphSdfGlyphPair, range: TopologyRange) {
  const anomalies: TransientAnomaly[] = []
  const maximumComponents = Math.max(range.source.components, range.target.components)
  const maximumHoles = Math.max(range.source.holes, range.target.holes)
  for (const progress of VALIDATION_PROGRESS) {
    const frame = renderFontMorphSdfFrame(pair, progress)
    const signature = topologySignature(frame, pair.size)
    if (signature.components > maximumComponents) {
      for (const region of structuralRegions(frame, pair.size, true).slice(
        0,
        signature.components - maximumComponents,
      )) {
        anomalies.push({ ...region, kind: 'component', progress })
      }
    }
    if (signature.holes > maximumHoles) {
      for (const region of structuralRegions(frame, pair.size, false).slice(
        0,
        signature.holes - maximumHoles,
      )) {
        anomalies.push({ ...region, kind: 'hole', progress })
      }
    }
  }

  const merged: TransientAnomaly[] = []
  for (const anomaly of anomalies) {
    const centerX = (anomaly.minX + anomaly.maxX) / 2
    const centerY = (anomaly.minY + anomaly.maxY) / 2
    const match = merged.find((candidate) => {
      if (candidate.kind !== anomaly.kind) return false
      const candidateX = (candidate.minX + candidate.maxX) / 2
      const candidateY = (candidate.minY + candidate.maxY) / 2
      return Math.hypot(centerX - candidateX, centerY - candidateY) <= pair.size * 0.05
    })
    if (!match) {
      merged.push(anomaly)
    } else if (anomaly.area > match.area) {
      Object.assign(match, anomaly)
    }
  }
  return merged
    .sort((left, right) => right.area - left.area || left.progress - right.progress)
    .slice(0, 2)
}

function fieldValue(field: Uint8Array, size: number, x: number, y: number) {
  const column = Math.max(0, Math.min(size - 1, Math.round(x)))
  const row = Math.max(0, Math.min(size - 1, Math.round(y)))
  return field[row * size + column]
}

function localRegistrationCandidates(pair: FontMorphSdfGlyphPair, range: TopologyRange) {
  const extent = pair.size - 1
  const candidates: { region: FontMorphSdfWarpRegion; cost: number }[] = []
  for (const [anomalyIndex, anomaly] of transientAnomalies(pair, range).entries()) {
    const centerX = (anomaly.minX + anomaly.maxX) / 2
    const centerY = (anomaly.minY + anomaly.maxY) / 2
    const width = anomaly.maxX - anomaly.minX + 1
    const height = anomaly.maxY - anomaly.minY + 1
    const patchRadius = Math.max(
      Math.round(pair.size * 0.04),
      Math.ceil(Math.max(width, height) * 1.5),
    )
    const maximumShift = Math.max(2, Math.round(pair.size * 0.1))
    const searchStep = Math.max(1, Math.round(pair.size / 64))
    const sampleStep = Math.max(1, Math.round(patchRadius / 5))
    const shifts: { x: number; y: number; cost: number }[] = []
    for (let y = -maximumShift; y <= maximumShift; y += searchStep) {
      for (let x = -maximumShift; x <= maximumShift; x += searchStep) {
        if (x === 0 && y === 0) continue
        let difference = 0
        let samples = 0
        const sourceCenterX = centerX - anomaly.progress * x
        const sourceCenterY = centerY - anomaly.progress * y
        const targetCenterX = centerX + (1 - anomaly.progress) * x
        const targetCenterY = centerY + (1 - anomaly.progress) * y
        for (let patchY = -patchRadius; patchY <= patchRadius; patchY += sampleStep) {
          for (let patchX = -patchRadius; patchX <= patchRadius; patchX += sampleStep) {
            difference += Math.abs(
              fieldValue(
                pair.source.distance,
                pair.size,
                sourceCenterX + patchX,
                sourceCenterY + patchY,
              ) -
                fieldValue(
                  pair.target.distance,
                  pair.size,
                  targetCenterX + patchX,
                  targetCenterY + patchY,
                ),
            )
            samples += 1
          }
        }
        const movement = Math.hypot(x, y) / pair.size
        shifts.push({ x, y, cost: difference / samples + movement })
      }
    }
    shifts.sort((left, right) => left.cost - right.cost || left.y - right.y || left.x - right.x)
    for (const [shiftIndex, shift] of shifts.slice(0, 6).entries()) {
      for (const radiusScale of [1.5, 2.5]) {
        const radiusX = Math.max(pair.size * 0.06, width * radiusScale + Math.abs(shift.x))
        const radiusY = Math.max(pair.size * 0.06, height * radiusScale + Math.abs(shift.y))
        const control = (x: number, y: number): FontMorphSdfWarpControl => ({
          center: [Math.max(0, Math.min(1, x / extent)), Math.max(0, Math.min(1, y / extent))],
          radius: [Math.min(1, radiusX / extent), Math.min(1, radiusY / extent)],
        })
        candidates.push({
          cost: shift.cost + radiusScale / 100,
          region: {
            id: `auto-local-${anomalyIndex}-${shiftIndex}-${radiusScale}`,
            source: control(
              centerX - anomaly.progress * shift.x,
              centerY - anomaly.progress * shift.y,
            ),
            target: control(
              centerX + (1 - anomaly.progress) * shift.x,
              centerY + (1 - anomaly.progress) * shift.y,
            ),
          },
        })
      }
    }
  }
  return candidates
    .sort((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost
      return left.region.id < right.region.id ? -1 : left.region.id > right.region.id ? 1 : 0
    })
    .slice(0, 12)
    .map(({ region }, index) => ({ ...region, id: `auto-local-${String(index).padStart(2, '0')}` }))
}

function selectRegistration(
  pair: FontMorphSdfGlyphPair,
  range: TopologyRange,
  selected: FontMorphSdfWarpRegion[],
  penalty: number,
  candidates: FontMorphSdfWarpRegion[],
) {
  const remaining = [...candidates]
  while (penalty > 0 && selected.length < MAX_WARP_REGIONS && remaining.length) {
    let bestIndex = -1
    let bestPenalty = penalty
    for (let index = 0; index < remaining.length; index += 1) {
      const candidatePenalty = topologyPenalty(pair, [...selected, remaining[index]], range)
      if (candidatePenalty < bestPenalty) {
        bestPenalty = candidatePenalty
        bestIndex = index
      }
    }
    if (bestIndex < 0) break
    selected = [...selected, remaining.splice(bestIndex, 1)[0]]
    penalty = bestPenalty
  }
  return { selected, penalty }
}

/**
 * Finds the smallest deterministic local registration that removes topology
 * outside the two endpoint signatures. Fonts and characters are never named
 * or special-cased; stable glyphs take the zero-region fast path.
 */
export function discoverSdfWarpRegions(pair: FontMorphSdfGlyphPair) {
  const range = {
    source: topologySignature(pair.source.distance, pair.size),
    target: topologySignature(pair.target.distance, pair.size),
  }
  let selected: FontMorphSdfWarpRegion[] = []
  let penalty = topologyPenalty(pair, selected, range)
  if (penalty === 0) return selected

  ;({ selected, penalty } = selectRegistration(
    pair,
    range,
    selected,
    penalty,
    registrationCandidates(pair),
  ))
  if (penalty > 0) {
    ;({ selected, penalty } = selectRegistration(
      pair,
      range,
      selected,
      penalty,
      localRegistrationCandidates(pair, range),
    ))
  }
  if (penalty > 0) {
    throw new RangeError(
      `font-morph could not automatically resolve intermediate topology for ${pair.unicode}`,
    )
  }
  return selected
}
