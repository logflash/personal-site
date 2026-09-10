import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FONT_MORPH_EVENT_TAG,
  SETTLED_TEXT_HOLD_MS,
  configureFontMorph,
  compileFontMorphManifest,
  createFontMorphReplayDirector,
  prepareFontMorph,
  reserveFontMorphSettledTextHolds,
  type FontMorphEvent,
} from '../index'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function morphEvent(settledTextHold?: number): FontMorphEvent {
  return {
    type: 5,
    timestamp: 1_000,
    data: {
      tag: FONT_MORPH_EVENT_TAG,
      payload: {
        version: 2,
        key: 'title',
        duration: 600,
        ...(settledTextHold === undefined ? {} : { settledTextHold }),
        source: {},
        target: {},
      },
    },
  }
}

function legacyMorphEvent(): FontMorphEvent {
  const event = morphEvent()
  return {
    ...event,
    data: { ...(event.data as object), tag: 'gt-font-morph' },
  }
}

describe('font-morph public API', () => {
  it('can be configured without browser globals', () => {
    expect(() =>
      configureFontMorph({
        fontFiles: { sans: ['/sans.otf'], serif: ['/serif.otf'] },
      }),
    ).not.toThrow()
  })

  it('makes server-side preparation a no-op', async () => {
    await expect(prepareFontMorph('title')).resolves.toBeUndefined()
  })

  it('adds the default settled-text hold without mutating its input', () => {
    const event = morphEvent()
    const events = [event]
    const prepared = reserveFontMorphSettledTextHolds(events)

    expect(prepared).not.toBe(events)
    expect(prepared[0]).not.toBe(event)
    expect(
      (prepared[0].data as { payload: { settledTextHold: number } }).payload.settledTextHold,
    ).toBe(SETTLED_TEXT_HOLD_MS)
    expect((event.data as { payload: { settledTextHold?: number } }).payload.settledTextHold).toBe(
      undefined,
    )
  })

  it('retains replay compatibility with the pre-extraction event tag', () => {
    const [prepared] = reserveFontMorphSettledTextHolds([legacyMorphEvent()])
    expect((prepared.data as { payload: { settledTextHold: number } }).payload.settledTextHold).toBe(
      SETTLED_TEXT_HOLD_MS,
    )
  })

  it.each([0, 275])('preserves an explicit %sms settled-text hold', (hold) => {
    const events = [morphEvent(hold)]
    expect(reserveFontMorphSettledTextHolds(events)).toBe(events)
  })

  it('leaves unrelated event streams referentially unchanged', () => {
    const events: FontMorphEvent[] = [{ type: 4, timestamp: 0, data: { width: 800 } }]
    expect(reserveFontMorphSettledTextHolds(events)).toBe(events)
  })

  it('accepts an explicit teardown frame without retaining state', () => {
    const director = createFontMorphReplayDirector()
    expect(director({ time: Number.NaN, document: null, events: [] })).toBeUndefined()
  })

  it('uses variation-correct disconnected contours in prepared KUTE outlines', async () => {
    const [sansBytes, serifBytes] = await Promise.all([
      readFile(resolve(packageRoot, 'demo/public/fonts/ibm-plex-sans-400-outline.ttf')),
      readFile(resolve(packageRoot, 'demo/public/fonts/source-serif-4-600-outline.ttf')),
    ])
    const manifest = await compileFontMorphManifest(
      {
        sans: [sansBytes.buffer.slice(sansBytes.byteOffset, sansBytes.byteOffset + sansBytes.byteLength)],
        serif: [serifBytes.buffer.slice(serifBytes.byteOffset, serifBytes.byteOffset + serifBytes.byteLength)],
      },
      [{
        text: 'í',
        source: { role: 'sans', weight: 500, opticalSize: 0 },
        target: { role: 'serif', weight: 600, opticalSize: 60 },
      }],
    )
    const outline = Object.values(manifest.outlines)[0]
    const accent = outline.contours
      ?.filter((contour) => contour.glyphIndex === 0 && contour.depth === 0)
      .map((contour) => ({
        contour,
        top: Math.min(...contour.target.map(([, y]) => y)),
      }))
      .sort((left, right) => left.top - right.top)[0]?.contour
    expect(accent).toBeDefined()
    const horizontal = accent!.target.map(([x]) => x)
    expect(Math.min(...horizontal)).toBeCloseTo(99, 0)
    expect(Math.max(...horizontal)).toBeCloseTo(281, 0)
  })

  it('leaves static fallback faces uninstanced in prepared KUTE outlines', async () => {
    const [sansBytes, serifBytes] = await Promise.all([
      readFile(resolve(packageRoot, 'demo/public/fonts/noto-sans-jp-400-outline.ttf')),
      readFile(resolve(packageRoot, 'demo/public/fonts/noto-serif-jp-600-outline.ttf')),
    ])
    const manifest = await compileFontMorphManifest(
      {
        sans: [sansBytes.buffer.slice(sansBytes.byteOffset, sansBytes.byteOffset + sansBytes.byteLength)],
        serif: [serifBytes.buffer.slice(serifBytes.byteOffset, serifBytes.byteOffset + serifBytes.byteLength)],
      },
      [{
        text: '履歴書',
        source: { role: 'sans', weight: 500, opticalSize: 0 },
        target: { role: 'serif', weight: 600, opticalSize: 23 },
      }],
    )
    const outline = Object.values(manifest.outlines)[0]
    expect(outline.fallback).toBeUndefined()
    expect(outline.contours?.length).toBeGreaterThan(0)
  })
})
