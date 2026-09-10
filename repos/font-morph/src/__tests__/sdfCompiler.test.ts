import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compileSdfGlyphPair,
  stableStringify,
  type FontMorphSdfLandmarkOverride,
} from '../compiler'
import { renderFontMorphSdfFrame } from '../sdf-runtime'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function font(name: string) {
  const bytes = await readFile(resolve(packageRoot, `demo/public/fonts/${name}`))
  return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

async function landmarkOverride(name: string) {
  return JSON.parse(
    await readFile(resolve(packageRoot, `data/overrides/sdf/v1/${name}`), 'utf8'),
  ) as FontMorphSdfLandmarkOverride
}

function componentCount(field: Float32Array, size: number) {
  const visited = new Uint8Array(field.length)
  let components = 0
  for (let start = 0; start < field.length; start += 1) {
    if (field[start] <= 128 || visited[start]) continue
    components += 1
    const queue = [start]
    visited[start] = 1
    while (queue.length) {
      const index = queue.pop()!
      const x = index % size
      const y = Math.floor(index / size)
      for (const neighbor of [index - 1, index + 1, index - size, index + size]) {
        if (neighbor < 0 || neighbor >= field.length) continue
        const neighborX = neighbor % size
        const neighborY = Math.floor(neighbor / size)
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue
        if (field[neighbor] > 128 && !visited[neighbor]) {
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
    }
  }
  return components
}

function holeCount(field: Float32Array, size: number) {
  const visited = new Uint8Array(field.length)
  const queue: number[] = []
  const enqueue = (index: number) => {
    if (field[index] <= 128 && !visited[index]) {
      visited[index] = 1
      queue.push(index)
    }
  }
  for (let coordinate = 0; coordinate < size; coordinate += 1) {
    enqueue(coordinate)
    enqueue((size - 1) * size + coordinate)
    enqueue(coordinate * size)
    enqueue(coordinate * size + size - 1)
  }
  while (queue.length) {
    const index = queue.pop()!
    const x = index % size
    const y = Math.floor(index / size)
    for (const neighbor of [index - 1, index + 1, index - size, index + size]) {
      if (neighbor < 0 || neighbor >= field.length) continue
      const neighborX = neighbor % size
      const neighborY = Math.floor(neighbor / size)
      if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue
      enqueue(neighbor)
    }
  }
  let holes = 0
  for (let start = 0; start < field.length; start += 1) {
    if (field[start] > 128 || visited[start]) continue
    holes += 1
    enqueue(start)
    while (queue.length) {
      const index = queue.pop()!
      const x = index % size
      const y = Math.floor(index / size)
      for (const neighbor of [index - 1, index + 1, index - size, index + size]) {
        if (neighbor < 0 || neighbor >= field.length) continue
        const neighborX = neighbor % size
        const neighborY = Math.floor(neighbor / size)
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue
        enqueue(neighbor)
      }
    }
  }
  return holes
}

describe('distance-field structural correspondence', () => {
  it('compiles deterministic font-local landmarks and prevents a transient split', async () => {
    const source = await font('noto-sans-jp-400-outline.ttf')
    const target = await font('noto-serif-jp-600-outline.ttf')
    const landmarkOverrides = [
      await landmarkOverride('noto-sans-jp-400-U+6B74.json'),
      await landmarkOverride('noto-serif-jp-600-U+6B74.json'),
    ]
    const options = {
      size: 256,
      pixelsPerEm: 1024,
      maximumDistance: 64,
      supersampling: 4,
      landmarkOverrides,
    }
    const started = performance.now()
    const first = compileSdfGlyphPair(source, target, '歴', options)
    const second = compileSdfGlyphPair(source, target, '歴', options)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(stableStringify(first)).toBe(stableStringify(second))
    expect(first.warpRegions.map(({ manifoldId }) => manifoldId)).toEqual(['top-horizontal'])

    expect(renderFontMorphSdfFrame(first, 0)).toEqual(Float32Array.from(first.source.distance))
    expect(renderFontMorphSdfFrame(first, 1)).toEqual(Float32Array.from(first.target.distance))
    const endpointMaximum = Math.max(
      componentCount(renderFontMorphSdfFrame(first, 0), first.size),
      componentCount(renderFontMorphSdfFrame(first, 1), first.size),
    )
    const withoutLandmarks = { ...first, warpRegions: [] }
    expect(componentCount(renderFontMorphSdfFrame(withoutLandmarks, 0.5), first.size)).toBeGreaterThan(endpointMaximum)
    expect(componentCount(renderFontMorphSdfFrame(first, 0.5), first.size)).toBeLessThanOrEqual(endpointMaximum)
    expect(renderFontMorphSdfFrame(first, 0.37)).toEqual(renderFontMorphSdfFrame(first, 0.37))
  })

  it('does not perturb glyphs without compiled landmark regions', async () => {
    const pair = compileSdfGlyphPair(
      await font('ibm-plex-sans-400-outline.ttf'),
      await font('source-serif-4-600-outline.ttf'),
      'R',
      { size: 64, pixelsPerEm: 256, maximumDistance: 24, supersampling: 2 },
    )
    expect(pair.warpRegions).toEqual([])
    for (const sample of [0, 0.01, 0.125, 0.25, 0.5, 0.75, 0.875, 0.99, 1]) {
      expect(holeCount(renderFontMorphSdfFrame(pair, sample), pair.size)).toBe(1)
    }
    const progress = 0.375
    const frame = renderFontMorphSdfFrame(pair, progress)
    for (let index = 0; index < frame.length; index += 1) {
      expect(frame[index]).toBeCloseTo(
        pair.source.distance[index] +
          (pair.target.distance[index] - pair.source.distance[index]) * progress,
        6,
      )
    }
  })

  it('rejects incomplete and stale reviewed mappings', async () => {
    const source = await font('noto-sans-jp-400-outline.ttf')
    const target = await font('noto-serif-jp-600-outline.ttf')
    const sourceOverride = await landmarkOverride('noto-sans-jp-400-U+6B74.json')
    const targetOverride = await landmarkOverride('noto-serif-jp-600-U+6B74.json')
    expect(() =>
      compileSdfGlyphPair(source, target, '歴', {
        size: 64,
        pixelsPerEm: 256,
        landmarkOverrides: [sourceOverride],
      }),
    ).toThrow(/must map both fonts/)
    expect(() =>
      compileSdfGlyphPair(source, target, '歴', {
        size: 64,
        pixelsPerEm: 256,
        landmarkOverrides: [{ ...sourceOverride, glyphId: sourceOverride.glyphId + 1 }, targetOverride],
      }),
    ).toThrow(/stale/)
  })
})
