import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileSdfGlyphPair, stableStringify } from '../compiler'
import { renderFontMorphSdfFrame } from '../sdf-runtime'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function font(name: string) {
  const bytes = await readFile(resolve(packageRoot, `demo/public/fonts/${name}`))
  return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

function componentCount(field: Float32Array, size: number) {
  const visited = new Uint8Array(field.length)
  const minimumArea = Math.max(2, Math.floor((size * size) / 4096))
  let components = 0
  for (let start = 0; start < field.length; start += 1) {
    if (field[start] <= 128 || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    let area = 0
    while (queue.length) {
      const index = queue.pop()!
      area += 1
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
    if (area >= minimumArea) components += 1
  }
  return components
}

function holeCount(field: Float32Array, size: number) {
  const visited = new Uint8Array(field.length)
  const minimumArea = Math.max(2, Math.floor((size * size) / 4096))
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
    let area = 0
    enqueue(start)
    while (queue.length) {
      const index = queue.pop()!
      area += 1
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
    if (area >= minimumArea) holes += 1
  }
  return holes
}

describe('distance-field structural correspondence', () => {
  it('discovers deterministic local registration and prevents a transient split', async () => {
    const source = await font('noto-sans-jp-400-outline.ttf')
    const target = await font('noto-serif-jp-600-outline.ttf')
    const options = {
      size: 256,
      pixelsPerEm: 1024,
      maximumDistance: 64,
      supersampling: 4,
    }
    const started = performance.now()
    const first = compileSdfGlyphPair(source, target, '歴', options)
    const second = compileSdfGlyphPair(source, target, '歴', options)
    expect(performance.now() - started).toBeLessThan(4_000)
    expect(stableStringify(first)).toBe(stableStringify(second))
    expect(first.warpRegions.length).toBeGreaterThan(0)
    expect(first.warpRegions.every(({ id }) => id.startsWith('auto-'))).toBe(true)

    expect(renderFontMorphSdfFrame(first, 0)).toEqual(Float32Array.from(first.source.distance))
    expect(renderFontMorphSdfFrame(first, 1)).toEqual(Float32Array.from(first.target.distance))
    const endpointMaximum = Math.max(
      componentCount(renderFontMorphSdfFrame(first, 0), first.size),
      componentCount(renderFontMorphSdfFrame(first, 1), first.size),
    )
    const withoutRegistration = { ...first, warpRegions: [] }
    expect(
      componentCount(renderFontMorphSdfFrame(withoutRegistration, 0.5), first.size),
    ).toBeGreaterThan(endpointMaximum)
    expect(componentCount(renderFontMorphSdfFrame(first, 0.5), first.size)).toBeLessThanOrEqual(
      endpointMaximum,
    )
    expect(renderFontMorphSdfFrame(first, 0.37)).toEqual(renderFontMorphSdfFrame(first, 0.37))
  })

  it('does not perturb glyphs that need no automatic registration', async () => {
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

  it('derives local registration for a transient counter without an override', async () => {
    const source = await font('ibm-plex-sans-400-outline.ttf')
    const target = await font('source-serif-4-600-outline.ttf')
    const pair = compileSdfGlyphPair(
      { ...source, axes: { wght: 500 } },
      { ...target, axes: { opsz: 20 } },
      'r',
      { size: 128, pixelsPerEm: 512, maximumDistance: 64, supersampling: 4 },
    )
    const withoutRegistration = { ...pair, warpRegions: [] }
    const endpointMaximum = Math.max(
      holeCount(renderFontMorphSdfFrame(pair, 0), pair.size),
      holeCount(renderFontMorphSdfFrame(pair, 1), pair.size),
    )

    expect(
      holeCount(renderFontMorphSdfFrame(withoutRegistration, 0.75), pair.size),
    ).toBeGreaterThan(endpointMaximum)
    expect(pair.warpRegions.map(({ id }) => id)).toEqual(['auto-local-00'])
    expect(holeCount(renderFontMorphSdfFrame(pair, 0.75), pair.size)).toBe(endpointMaximum)
  })

  it.each(['き', 'さ'])('allows legitimate connectivity changes for %s', async (unicode) => {
    const pair = compileSdfGlyphPair(
      await font('noto-sans-jp-400-outline.ttf'),
      await font('noto-serif-jp-600-outline.ttf'),
      unicode,
      { size: 128, pixelsPerEm: 512, maximumDistance: 48, supersampling: 2 },
    )
    const endpointComponents = [
      componentCount(renderFontMorphSdfFrame(pair, 0), pair.size),
      componentCount(renderFontMorphSdfFrame(pair, 1), pair.size),
    ]
    const endpointHoles = [
      holeCount(renderFontMorphSdfFrame(pair, 0), pair.size),
      holeCount(renderFontMorphSdfFrame(pair, 1), pair.size),
    ]
    for (const progress of [0.125, 0.25, 0.5, 0.75, 0.875]) {
      const frame = renderFontMorphSdfFrame(pair, progress)
      expect(componentCount(frame, pair.size)).toBeGreaterThanOrEqual(
        Math.min(...endpointComponents),
      )
      expect(componentCount(frame, pair.size)).toBeLessThanOrEqual(Math.max(...endpointComponents))
      expect(holeCount(frame, pair.size)).toBeGreaterThanOrEqual(Math.min(...endpointHoles))
      expect(holeCount(frame, pair.size)).toBeLessThanOrEqual(Math.max(...endpointHoles))
    }
  })
})
