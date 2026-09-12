import type { eventWithTime } from '@rrweb/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prepareFrames, renderFrame } = vi.hoisted(() => ({
  prepareFrames: vi.fn(),
  renderFrame: vi.fn(),
}))

vi.mock('font-morph', () => ({
  SETTLED_TEXT_HOLD_MS: 500,
  createFontMorphFrameRenderer: () => renderFrame,
  prepareFontMorphFrames: prepareFrames,
}))

import {
  createFontMorphReplayDirector,
  prepareFontMorphReplay,
  reserveFontMorphSettledTextHolds,
} from '../font-morph'

function morphEvent(
  tag = 'font-morph',
  settledTextHold?: number,
  leadIn?: number,
): eventWithTime {
  return {
    type: 5,
    timestamp: 1_000,
    data: {
      tag,
      payload: {
        version: 2,
        key: 'title',
        duration: 600,
        ...(settledTextHold === undefined ? {} : { settledTextHold }),
        ...(leadIn === undefined ? {} : { leadIn }),
        source: {
          text: 'Resume',
          translationHash: 'resume-hash',
        },
        target: {
          text: 'Resume',
        },
      },
    },
  } as unknown as eventWithTime
}

function metadataEvent(width = 400, height = 300): eventWithTime {
  return {
    type: 4,
    timestamp: 0,
    data: { width, height },
  } as eventWithTime
}

function frame(
  events: eventWithTime[],
  time: number,
  locale = 'en',
  document = {} as Document,
): Parameters<ReturnType<typeof createFontMorphReplayDirector>>[0] {
  return {
    time,
    locale,
    events,
    document,
    overlayRoot: null,
  }
}

describe('font-morph replay adapter', () => {
  beforeEach(() => {
    prepareFrames.mockReset().mockResolvedValue(undefined)
    renderFrame.mockReset()
  })

  it('exports the gt-rrweb-owned replay helpers', () => {
    expect(createFontMorphReplayDirector).toBeTypeOf('function')
    expect(prepareFontMorphReplay).toBeTypeOf('function')
    expect(reserveFontMorphSettledTextHolds).toBeTypeOf('function')
  })

  it('adds the default settled-text hold without mutating its input', () => {
    const event = morphEvent()
    const events = [event]
    const prepared = reserveFontMorphSettledTextHolds(events)

    expect(prepared).not.toBe(events)
    expect(prepared[0]).not.toBe(event)
    expect(
      (
        prepared[0].data as unknown as {
          payload: { settledTextHold: number }
        }
      ).payload.settledTextHold,
    ).toBe(500)
    expect(
      (
        event.data as unknown as {
          payload: { settledTextHold?: number }
        }
      ).payload.settledTextHold,
    ).toBeUndefined()
  })

  it('retains legacy event-tag compatibility', () => {
    const [prepared] = reserveFontMorphSettledTextHolds([morphEvent('gt-font-morph')])
    expect(
      (
        prepared.data as unknown as {
          payload: { settledTextHold: number }
        }
      ).payload.settledTextHold,
    ).toBe(500)
  })

  it.each([0, 275])('preserves an explicit %sms settled-text hold', (hold) => {
    const events = [morphEvent('font-morph', hold)]
    expect(reserveFontMorphSettledTextHolds(events)).toBe(events)
  })

  it('leaves unrelated event streams referentially unchanged', () => {
    const events = [{ type: 4, timestamp: 0, data: { width: 800 } }] as unknown as eventWithTime[]
    expect(reserveFontMorphSettledTextHolds(events)).toBe(events)
  })

  it('accepts an explicit teardown frame without retaining state', () => {
    const director = createFontMorphReplayDirector()
    expect(
      director({
        time: Number.NaN,
        document: null,
        events: [],
        overlayRoot: null,
      }),
    ).toBeUndefined()
    expect(renderFrame).toHaveBeenCalledWith(
      expect.objectContaining({ document: null, payload: null, phase: 'idle' }),
    )
  })

  it('does not add renderer geometry or per-frame state to recordings', () => {
    const serialized = JSON.stringify(morphEvent())
    expect(serialized).not.toMatch(/distanceBase64|sdfMorphs|contours|pixel|texture|frames/)
  })

  it('prepares translated text against the recording capture frame', async () => {
    const events = [
      metadataEvent(360, 720),
      {
        type: 2,
        timestamp: 1,
        data: {
          node: {
            tagName: 'html',
            attributes: { style: '--gt-capture-height-ratio: 1.5' },
          },
        },
      } as unknown as eventWithTime,
      morphEvent(),
    ]
    const resolveText = vi.fn((locale: string | undefined) =>
      locale === 'ja' ? '履歴書' : 'Resume',
    )
    const document = {} as Document

    await prepareFontMorphReplay(events, ['en', 'ja'], resolveText, document)

    expect(prepareFrames).toHaveBeenCalledOnce()
    expect(prepareFrames).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          text: 'Resume',
          captureFrame: {
            screen: { left: 0, top: 0, width: 1_000, height: 1_500 },
            logicalWidth: 360,
            logicalHeight: 540,
          },
        }),
        expect.objectContaining({
          text: '履歴書',
          captureFrame: {
            screen: { left: 0, top: 0, width: 1_000, height: 1_500 },
            logicalWidth: 360,
            logicalHeight: 540,
          },
        }),
      ],
      document,
    )
  })

  it('renders a pure absolute-progress frame from rrweb time', () => {
    const events = [metadataEvent(), morphEvent()]
    const director = createFontMorphReplayDirector()

    director(frame(events, 1_300))

    expect(renderFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'Resume',
        progress: 0.5,
        phase: 'active',
      }),
    )
  })

  it('uses the recorded mutation as the lead-in activation boundary', () => {
    const mutation = {
      type: 3,
      timestamp: 850,
      data: {
        source: 0,
        attributes: [
          { attributes: { 'data-font-morph-active': 'title' } },
        ],
      },
    } as unknown as eventWithTime
    const events = [metadataEvent(), mutation, morphEvent('font-morph', 500, 50)]
    const director = createFontMorphReplayDirector()

    director(frame(events, 875))

    expect(renderFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'active', progress: -0.20833333333333334 }),
    )
  })

  it('skips an unreadable settled hold but retains a visible one', () => {
    const events = [metadataEvent(), morphEvent()]
    const invisibleDirector = createFontMorphReplayDirector()
    renderFrame.mockReturnValueOnce({ destinationVisible: false })
    expect(invisibleDirector(frame(events, 1_700))).toEqual({ advanceTo: 2_100 })

    const visibleDirector = createFontMorphReplayDirector()
    renderFrame.mockReturnValueOnce({ destinationVisible: true })
    expect(visibleDirector(frame(events, 1_700))).toBeUndefined()
  })

  it('cuts a locale change to the settled destination without changing replay length', () => {
    const events = [metadataEvent(), morphEvent()]
    const director = createFontMorphReplayDirector((_locale, _hash, recorded) => recorded)
    const document = {} as Document
    director(frame(events, 1_200, 'en', document))

    expect(director(frame(events, 1_250, 'ja', document))).toEqual({ advanceTo: 1_600 })
    expect(renderFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ progress: 1, phase: 'settled' }),
    )
  })

  it('rebuilds transient renderer state after a backward seek', () => {
    const events = [metadataEvent(), morphEvent()]
    const director = createFontMorphReplayDirector()
    director(frame(events, 1_400))
    renderFrame.mockClear()

    director(frame(events, 1_200))

    expect(renderFrame).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ payload: null, phase: 'idle' }),
    )
    expect(renderFrame).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ progress: 1 / 3, phase: 'active' }),
    )
  })

  it('advances past both animation and hold when the renderer finishes off-screen', () => {
    const events = [metadataEvent(), morphEvent()]
    const director = createFontMorphReplayDirector()
    renderFrame.mockReturnValueOnce({ completedEarly: true })

    expect(director(frame(events, 1_200))).toEqual({ advanceTo: 2_100 })
  })
})
