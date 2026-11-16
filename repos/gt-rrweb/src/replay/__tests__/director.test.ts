import type { eventWithTime } from '@rrweb/types';
import { describe, expect, it } from 'vitest';

import {
  REPLAY_EVENT,
  REPLAY_SOURCE,
  analyzePointerInput,
  buildScrollTracks,
  clampScrollPosition,
  collectDirectedClicks,
  createClickPositionResolver,
  cursorGlideStart,
  compressTimeline,
  detectDoubleClicks,
  firstScrollTimeBetween,
  incrementalData,
  markScrollBurstStarts,
  projectPointIntoRect,
  rectAtScrollPosition,
  replaceNativeScrollEvents,
  scrollDeltaToRevealRect,
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

describe('directed pointer target projection', () => {
  it('waits for expansion before approaching a target in the expanded layout', () => {
    expect(cursorGlideStart(100, 1000, 200, [50, 300, 1100])).toBe(300);
    expect(cursorGlideStart(100, 1000, 200, [50])).toBe(200);
    expect(cursorGlideStart(100, 1000, null, [50])).toBe(100);
    expect(cursorGlideStart(100, 1000, null, [300, 1000])).toBe(300);
  });

  it('does not move a completed click when collapsing content clamps its scroll container', () => {
    const click = { t: 100, id: 4, x: 40, y: 400 };
    let target = { x: 40, y: 400 };
    const positions = createClickPositionResolver(() => target);
    expect(positions.at(click, 99)).toEqual({ x: 40, y: 400 });
    // The same summary moves down as the browser clamps the shorter page.
    target = { x: 40, y: 600 };
    expect(positions.at(click, 120)).toEqual({ x: 40, y: 400 });
  });

  it('keeps an expansion click in place while resolving the next click after automatic scrolling', () => {
    const expand = { t: 100, id: 4, x: 40, y: 600 };
    const next = { t: 500, id: 4, x: 40, y: 400 };
    let target = { x: 40, y: 600 };
    const positions = createClickPositionResolver(() => target);
    positions.at(expand, 99);
    target = { x: 40, y: 450 };
    expect(positions.at(next, 300)).toEqual({ x: 40, y: 450 });
    target = { x: 40, y: 400 };
    expect(positions.at(next, 499)).toEqual({ x: 40, y: 400 });
    expect(positions.at(expand, 499)).toEqual({ x: 40, y: 600 });
    expect(positions.at(next, 600)).toEqual({ x: 40, y: 400 });
  });

  it('retains completed waypoints on seek and re-resolves them after a locale change', () => {
    const click = { t: 100, id: 4, x: 40, y: 400 };
    let target = { x: 40, y: 400 };
    const positions = createClickPositionResolver(() => target);
    positions.at(click, 99);
    target = { x: 40, y: 600 };
    expect(positions.at(click, 900)).toEqual({ x: 40, y: 400 });
    expect(positions.at(click, 120)).toEqual({ x: 40, y: 400 });
    positions.clear();
    expect(positions.at(click, 120)).toEqual({ x: 40, y: 600 });
  });

  it('uses the scroll position a shorter translated document can actually reach', () => {
    expect(clampScrollPosition({ x: 0, y: 1545 }, { x: 0, y: 1460 })).toEqual({
      x: 0,
      y: 1460,
    });
  });

  it('preserves a recorded point while it remains inside the target', () => {
    expect(
      projectPointIntoRect(
        { x: 40, y: 30 },
        { left: 10, top: 20, right: 80, bottom: 60 },
      ),
    ).toEqual({ x: 40, y: 30 });
  });

  it('follows the nearest target edge continuously instead of jumping to its center', () => {
    const point = { x: 40, y: 30 };
    const positions = [39, 39.5, 40, 40.5, 41].map(
      (left) =>
        projectPointIntoRect(point, {
          left,
          top: 20,
          right: left + 80,
          bottom: 60,
        }).x,
    );
    expect(positions).toEqual([40, 40, 40.5, 41, 41.5]);
    expect(Math.max(...positions.slice(1).map((x, index) => x - positions[index]))).toBe(0.5);
  });

  it('keeps corrected click points just inside a translated target', () => {
    expect(
      projectPointIntoRect(
        { x: 10, y: 100 },
        { left: 60, top: 20, right: 100, bottom: 80 },
      ),
    ).toEqual({ x: 60.5, y: 79.5 });
  });

  it('reconstructs a target rectangle at its click-time scroll position', () => {
    expect(
      rectAtScrollPosition(
        { left: 20, top: -280, right: 120, bottom: -240 },
        { x: 0, y: 700 },
        { x: 0, y: 0 },
      ),
    ).toEqual({ left: 20, top: 420, right: 120, bottom: 460 });
  });

  it('only requests scrolling for fully off-screen click targets', () => {
    const bounds = { left: 0, top: 0, right: 800, bottom: 600 };
    expect(
      scrollDeltaToRevealRect(
        { left: 20, top: 590, right: 200, bottom: 640 },
        bounds,
      ),
    ).toEqual({ x: 0, y: 0 });
    expect(
      scrollDeltaToRevealRect(
        { left: 20, top: 650, right: 200, bottom: 700 },
        bounds,
        10,
      ),
    ).toEqual({ x: 0, y: 110 });
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

  it('holds mutations until a compact host animation completes', () => {
    const events = [
      event(0, {}, REPLAY_EVENT.Meta),
      event(
        100,
        {
          tag: 'gt-animation',
          payload: {
            version: 1,
            kind: 'skill-card',
            duration: 420,
          },
        },
        REPLAY_EVENT.Custom,
      ),
      mutation(105),
    ];
    const input = analyzePointerInput(events);
    const compressed = compressTimeline(events, new Set(), input.isDirectedClick);
    expect(compressed[2].timestamp).toBe(520);
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

  it('keeps dwell for disclosure actions whose mutation shares the click timestamp', () => {
    const events = [
      mouse(100, 1),
      event(100, {
        source: REPLAY_SOURCE.Mutation,
        attributes: [{ id: 4, attributes: { open: '' } }],
      }),
      mouse(1100, 1),
    ];
    const input = analyzePointerInput(events);
    expect(detectDoubleClicks(events, input.isDirectedClick)).toEqual(new Set());
    const directed = compressTimeline(events, new Set(), input.isDirectedClick);
    expect(directed[2].timestamp - directed[1].timestamp).toBeGreaterThanOrEqual(550);
  });

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

  it('finds the first scroll between pointer waypoints', () => {
    const events = [scroll(200, 0), scroll(300, 100), scroll(600, 200)];
    const tracks = buildScrollTracks(events, 0, markScrollBurstStarts(events));
    expect(firstScrollTimeBetween(tracks, 100, 500)).toBe(200);
    expect(firstScrollTimeBetween(tracks, 300, 500)).toBeNull();
    expect(firstScrollTimeBetween(tracks, 300, 700)).toBe(600);
  });

  it('eases a singleton jump without changing its final timestamp', () => {
    const events = [scroll(0, 0), scroll(1000, 400)];
    const tracks = buildScrollTracks(events, 0, markScrollBurstStarts(events));
    const track = tracks.get(1)!;
    expect(scrollPositionAt(track, 550, [], linear)?.y).toBe(0);
    expect(scrollPositionAt(track, 775, [], linear)?.y).toBeCloseTo(200);
    expect(scrollPositionAt(track, 1000, [], linear)?.y).toBe(400);
  });

  it('does not anticipate the scroll clamp caused by collapsing a disclosure', () => {
    const events = [
      scroll(0, 700),
      event(1000, {
        source: REPLAY_SOURCE.Mutation,
        attributes: [{ id: 4, attributes: { open: null } }],
      }),
      scroll(1000, 400),
    ];
    const track = buildScrollTracks(events, 0, markScrollBurstStarts(events)).get(
      1,
    )!;
    expect(scrollPositionAt(track, 800, [], linear)?.y).toBe(700);
    expect(scrollPositionAt(track, 999, [], linear)?.y).toBe(700);
    expect(scrollPositionAt(track, 1000, [], linear)?.y).toBe(400);
  });

  it('starts an expansion scroll only after the content opens', () => {
    const events = [
      scroll(0, 400),
      event(900, {
        source: REPLAY_SOURCE.Mutation,
        attributes: [{ id: 4, attributes: { open: '' } }],
      }),
      scroll(1000, 700),
    ];
    const track = buildScrollTracks(events, 0, markScrollBurstStarts(events)).get(
      1,
    )!;
    expect(scrollPositionAt(track, 899, [], linear)?.y).toBe(400);
    expect(scrollPositionAt(track, 950, [], linear)?.y).toBe(550);
    expect(scrollPositionAt(track, 1000, [], linear)?.y).toBe(700);
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
