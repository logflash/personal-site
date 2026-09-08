import type { eventWithTime } from '@rrweb/types';
import { describe, expect, it } from 'vitest';

import {
  REPLAY_EVENT,
  REPLAY_SOURCE,
  analyzePointerInput,
  buildScrollTracks,
  collectDirectedClicks,
  compressTimeline,
  detectDoubleClicks,
  incrementalData,
  markScrollBurstStarts,
  replaceNativeScrollEvents,
  scrollPositionAt,
} from '../director';

function event(
  timestamp: number,
  data: Record<string, unknown>,
  type = REPLAY_EVENT.IncrementalSnapshot,
): eventWithTime {
  return { type, timestamp, data } as eventWithTime;
}

const mouse = (
  timestamp: number,
  type: number,
  extra: Record<string, unknown> = {},
) =>
  event(timestamp, {
    source: REPLAY_SOURCE.MouseInteraction,
    type,
    x: 20,
    y: 30,
    id: 4,
    ...extra,
  });

const scroll = (timestamp: number, y: number, id = 1) =>
  event(timestamp, { source: REPLAY_SOURCE.Scroll, id, x: 0, y });

const mutation = (timestamp: number) =>
  event(timestamp, {
    source: REPLAY_SOURCE.Mutation,
    adds: [{ parentId: 1, node: { type: 3, id: timestamp, textContent: 'x' } }],
    removes: [],
    texts: [],
    attributes: [],
  });

describe('directed pointer input', () => {
  it('uses the first mouse-down as the single click waypoint', () => {
    const events = [
      event(0, {} as Record<string, unknown>, REPLAY_EVENT.Meta),
      mouse(100, 1),
      mouse(110, 0),
      mouse(120, 2),
    ];
    const input = analyzePointerInput(events);
    const clicks = collectDirectedClicks(events, 0, input.isDirectedClick);
    expect(input.usesTouchControls).toBe(false);
    expect(clicks).toEqual([{ t: 100, x: 20, y: 30, id: 4 }]);
  });

  it('uses the synthetic click after touch-end as a tap and hides the cursor', () => {
    const events = [
      mouse(100, 7, { pointerType: 2 }),
      mouse(120, 9),
      mouse(130, 2, { pointerType: 2 }),
    ];
    const input = analyzePointerInput(events);
    expect(input.usesTouchControls).toBe(true);
    expect(collectDirectedClicks(events, 0, input.isDirectedClick)).toEqual([
      { t: 130, x: 20, y: 30, id: 4 },
    ]);
  });

  it('does not turn a touch swipe or cancelled gesture into a click', () => {
    const swipe = [mouse(100, 7, { pointerType: 2 }), mouse(180, 9)];
    const cancelled = [mouse(300, 7, { pointerType: 2 }), mouse(320, 10)];
    for (const events of [swipe, cancelled]) {
      const input = analyzePointerInput(events);
      expect(input.usesTouchControls).toBe(true);
      expect(collectDirectedClicks(events, 0, input.isDirectedClick)).toEqual(
        [],
      );
    }
  });
});

describe('directed timeline', () => {
  it('holds click-caused mutations until the deterministic ripple completes', () => {
    const events = [
      event(0, {}, REPLAY_EVENT.Meta),
      mouse(1000, 1),
      mutation(1010),
    ];
    const input = analyzePointerInput(events);
    const compressed = compressTimeline(
      events,
      new Set(),
      input.isDirectedClick,
    );
    expect(compressed[1].timestamp).toBe(900);
    expect(compressed[2].timestamp).toBe(1180);
  });

  it('holds later mutations for semantic animation plus settled-text time', () => {
    const events = [
      event(0, {}, REPLAY_EVENT.Meta),
      event(
        100,
        {
          tag: 'gt-font-morph',
          payload: { duration: 600, settledTextHold: 500 },
        },
        REPLAY_EVENT.Custom,
      ),
      mutation(150),
    ];
    const input = analyzePointerInput(events);
    const compressed = compressTimeline(
      events,
      new Set(),
      input.isDirectedClick,
    );
    expect(compressed[1].timestamp).toBe(100);
    expect(compressed[2].timestamp).toBe(1200);
  });

  it('accepts the standalone font-morph event namespace', () => {
    const events = [
      event(0, {}, REPLAY_EVENT.Meta),
      event(
        100,
        {
          tag: 'font-morph',
          payload: { duration: 600, settledTextHold: 500 },
        },
        REPLAY_EVENT.Custom,
      ),
      mutation(150),
    ];
    const input = analyzePointerInput(events);
    const compressed = compressTimeline(
      events,
      new Set(),
      input.isDirectedClick,
    );
    expect(compressed[2].timestamp).toBe(1200);
  });

  it('only suppresses a repeated press when nothing changed between presses', () => {
    const noChange = [mouse(100, 1), mouse(1000, 1)];
    const withChange = [mouse(100, 1), mutation(500), mouse(1000, 1)];
    const noChangeInput = analyzePointerInput(noChange);
    const withChangeInput = analyzePointerInput(withChange);
    expect(detectDoubleClicks(noChange, noChangeInput.isDirectedClick)).toEqual(
      new Set([100]),
    );
    expect(
      detectDoubleClicks(withChange, withChangeInput.isDirectedClick),
    ).toEqual(new Set());
  });
});

describe('directed scrolling', () => {
  const linear = (progress: number) => progress;

  it('interpolates every scroll burst smoothly and deterministically', () => {
    const events = [scroll(0, 0), scroll(100, 100), scroll(200, 200)];
    const tracks = buildScrollTracks(events, 0, markScrollBurstStarts(events));
    const track = tracks.get(1)!;
    expect(scrollPositionAt(track, 0, [], linear)).toEqual({ x: 0, y: 0 });
    expect(scrollPositionAt(track, 50, [], linear)?.y).toBeCloseTo(50);
    expect(scrollPositionAt(track, 150, [], linear)?.y).toBeCloseTo(150);
    expect(scrollPositionAt(track, 150, [], linear)).toEqual(
      scrollPositionAt(track, 150, [], linear),
    );
    expect(scrollPositionAt(track, 200, [], linear)).toEqual({ x: 0, y: 200 });
  });

  it('eases a singleton jump without changing its final timestamp', () => {
    const events = [scroll(0, 0), scroll(1000, 400)];
    const tracks = buildScrollTracks(events, 0, markScrollBurstStarts(events));
    const track = tracks.get(1)!;
    expect(scrollPositionAt(track, 550, [], linear)?.y).toBe(0);
    expect(scrollPositionAt(track, 775, [], linear)?.y).toBeCloseTo(200);
    expect(scrollPositionAt(track, 1000, [], linear)?.y).toBe(400);
  });

  it('replaces native rrweb scrolls so only the director applies position', () => {
    const original = [scroll(100, 80), mutation(120)];
    const replaced = replaceNativeScrollEvents(original);
    expect(replaced[0]).toMatchObject({
      type: REPLAY_EVENT.Custom,
      timestamp: 100,
      data: { tag: 'gt-directed-scroll', payload: null },
    });
    expect(replaced[1]).toBe(original[1]);
    expect(incrementalData(replaced[0])).toBeNull();
  });
});
