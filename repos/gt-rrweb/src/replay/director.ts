import type { eventWithTime } from '@rrweb/types';

export const REPLAY_EVENT = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const;

export const REPLAY_SOURCE = {
  Mutation: 0,
  MouseInteraction: 2,
  Scroll: 3,
} as const;

export type ReplayIncrementalData = {
  source?: number;
  type?: number;
  pointerType?: number;
  adds?: Array<{ node?: unknown }>;
  removes?: Array<{ id?: number }>;
  texts?: Array<{ id?: number; value?: string }>;
  attributes?: unknown[];
  x?: number;
  y?: number;
  id?: number;
};

export type DirectedClick = { t: number; x: number; y: number; id: number };

export type ScrollPoint = {
  t: number;
  x: number;
  y: number;
  burst: number;
  mx: number;
  my: number;
};

export type ScrollTrack = { id: number; burst: number; points: ScrollPoint[] };

export function incrementalData(
  event: eventWithTime,
): ReplayIncrementalData | null {
  return event.type === REPLAY_EVENT.IncrementalSnapshot
    ? (event.data as unknown as ReplayIncrementalData)
    : null;
}

export function eventSource(event: eventWithTime): number {
  const data = incrementalData(event);
  return data && typeof data.source === 'number' ? data.source : -1;
}

type FontMorphPayload = { duration: number; settledTextHold?: number };

export function fontMorphPayload(
  event: eventWithTime,
): FontMorphPayload | null {
  const custom = event as unknown as {
    type?: number;
    data?: { tag?: string; payload?: Partial<FontMorphPayload> };
  };
  const payload = custom.data?.payload;
  return custom.type === REPLAY_EVENT.Custom &&
    custom.data?.tag === 'gt-font-morph' &&
    Number.isFinite(payload?.duration) &&
    (payload?.duration ?? 0) > 0
    ? (payload as FontMorphPayload)
    : null;
}

/**
 * Select exactly one deterministic waypoint per real mouse press or completed
 * touch tap. Touch starts that become swipes never become click waypoints.
 */
export function analyzePointerInput(events: eventWithTime[]) {
  const directedData = new WeakSet<ReplayIncrementalData>();
  let sawTouchInput = false;
  let sawMousePress = false;
  let touchStarted = false;

  for (const event of events) {
    const data = incrementalData(event);
    if (!data || data.source !== REPLAY_SOURCE.MouseInteraction) continue;
    if (
      data.type === 7 ||
      data.type === 9 ||
      data.type === 10 ||
      data.pointerType === 2
    ) {
      sawTouchInput = true;
    }
    if (data.type === 1) sawMousePress = true;
    if (data.type === 7) {
      touchStarted = true;
      continue;
    }
    // A browser emits the synthetic Click after TouchEnd, so TouchEnd must not
    // clear the pending tap. TouchCancel does clear it; a completed Click below
    // consumes it. A swipe emits no Click and therefore creates no waypoint.
    if (data.type === 10) {
      touchStarted = false;
      continue;
    }
    const isTouchTap =
      data.type === 2 && data.pointerType === 2 && touchStarted;
    if (data.type === 1 || isTouchTap) {
      directedData.add(data);
      touchStarted = false;
    }
  }

  return {
    usesTouchControls: sawTouchInput && !sawMousePress,
    isDirectedClick(event: eventWithTime): boolean {
      const data = incrementalData(event);
      return !!data && directedData.has(data);
    },
  };
}

export function compressTimeline(
  events: eventWithTime[],
  hidden: Set<number>,
  isDirectedClick: (event: eventWithTime) => boolean,
): eventWithTime[] {
  if (!events.length) return [];
  const isMutation = (event: eventWithTime) =>
    eventSource(event) === REPLAY_SOURCE.Mutation;
  const WAIT = 200;
  const COLLAPSED = 30;
  const MIN_DWELL = 550;
  const MAX_DWELL = 900;
  const NEW_PRESS = 250;
  const CLICK_HOLD = 280;
  const out: eventWithTime[] = [{ ...events[0] }];
  let previousOriginal = events[0].timestamp;
  let directedTime = events[0].timestamp;
  let lastPressOriginal = isDirectedClick(events[0])
    ? events[0].timestamp
    : -Infinity;
  let animationEnd = -Infinity;
  let animationOriginalEnd = -Infinity;

  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    const originalTimestamp = event.timestamp;
    const originalGap = Math.max(0, originalTimestamp - previousOriginal);
    previousOriginal = originalTimestamp;
    const idleSincePress = originalTimestamp - lastPressOriginal;
    const press =
      isDirectedClick(event) &&
      idleSincePress > NEW_PRESS &&
      !hidden.has(originalTimestamp);
    if (isDirectedClick(event)) lastPressOriginal = originalTimestamp;

    if (press) {
      directedTime = Math.max(directedTime, animationEnd);
      if (originalTimestamp >= animationOriginalEnd) {
        directedTime += Math.min(
          MAX_DWELL,
          Math.max(MIN_DWELL, idleSincePress),
        );
      }
      animationEnd = directedTime + CLICK_HOLD;
    } else {
      directedTime += originalGap > WAIT ? COLLAPSED : originalGap;
    }

    const morph = fontMorphPayload(event);
    if (morph) {
      const settledTextHold =
        Number.isFinite(morph.settledTextHold) &&
        (morph.settledTextHold ?? 0) > 0
          ? (morph.settledTextHold ?? 0)
          : 0;
      const duration = morph.duration + settledTextHold;
      animationEnd = Math.max(animationEnd, directedTime + duration);
      animationOriginalEnd = Math.max(
        animationOriginalEnd,
        originalTimestamp + duration,
      );
    }
    if (isMutation(event) && directedTime < animationEnd)
      directedTime = animationEnd;
    out.push({ ...event, timestamp: directedTime });
  }
  return out;
}

export function detectDoubleClicks(
  events: eventWithTime[],
  isDirectedClick: (event: eventWithTime) => boolean,
): Set<number> {
  const NEW_PRESS = 250;
  const DOUBLE_CLICK_MS = 5000;
  const presses: number[] = [];
  let lastPress = -Infinity;
  for (const event of events) {
    const data = incrementalData(event);
    if (!data || !isDirectedClick(event)) continue;
    if (
      event.timestamp - lastPress > NEW_PRESS &&
      typeof data.x === 'number' &&
      typeof data.y === 'number'
    ) {
      presses.push(event.timestamp);
    }
    lastPress = event.timestamp;
  }

  const changedBetween = (start: number, end: number) =>
    events.some((event) => {
      if (event.timestamp <= start || event.timestamp > end) return false;
      const data = incrementalData(event);
      if (!data || data.source !== REPLAY_SOURCE.Mutation) return false;
      return !!(
        data.adds?.length ||
        data.removes?.length ||
        data.texts?.length ||
        data.attributes?.length
      );
    });

  const hidden = new Set<number>();
  for (let index = 0; index < presses.length - 1; index += 1) {
    const timestamp = presses[index];
    const next = presses[index + 1];
    if (
      next - timestamp <= DOUBLE_CLICK_MS &&
      !changedBetween(timestamp, next)
    ) {
      hidden.add(timestamp);
    }
  }
  return hidden;
}

export function collectDirectedClicks(
  events: eventWithTime[],
  timelineStart: number,
  isDirectedClick: (event: eventWithTime) => boolean,
): DirectedClick[] {
  const clicks: DirectedClick[] = [];
  for (const event of events) {
    const data = incrementalData(event);
    if (!data || !isDirectedClick(event)) continue;
    if (typeof data.x !== 'number' || typeof data.y !== 'number') continue;
    clicks.push({
      t: event.timestamp - timelineStart,
      x: data.x,
      y: data.y,
      id: typeof data.id === 'number' ? data.id : -1,
    });
  }
  return clicks;
}

const SCROLL_BURST_GAP = 200;

export function markScrollBurstStarts(events: eventWithTime[]) {
  const starts = new WeakSet<ReplayIncrementalData>();
  const lastScrollAt = new Map<number, number>();
  for (const event of events) {
    const data = incrementalData(event);
    if (
      !data ||
      data.source !== REPLAY_SOURCE.Scroll ||
      typeof data.id !== 'number'
    )
      continue;
    const previous = lastScrollAt.get(data.id);
    if (previous === undefined || event.timestamp - previous > SCROLL_BURST_GAP)
      starts.add(data);
    lastScrollAt.set(data.id, event.timestamp);
  }
  return starts;
}

function scrollTangent(points: ScrollPoint[], index: number, key: 'x' | 'y') {
  const point = points[index];
  const previous = points[index - 1];
  const next = points[index + 1];
  const hasPrevious = previous && previous.burst === point.burst;
  const hasNext = next && next.burst === point.burst;
  if (!hasPrevious && !hasNext) return 0;
  const slope = (left: ScrollPoint, right: ScrollPoint) =>
    (right[key] - left[key]) / Math.max(1, right.t - left.t);
  if (!hasPrevious) return slope(point, next);
  if (!hasNext) return slope(previous, point);
  const before = slope(previous, point);
  const after = slope(point, next);
  if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after))
    return 0;
  const beforeSpan = point.t - previous.t;
  const afterSpan = next.t - point.t;
  const beforeWeight = 2 * afterSpan + beforeSpan;
  const afterWeight = afterSpan + 2 * beforeSpan;
  return (
    (beforeWeight + afterWeight) / (beforeWeight / before + afterWeight / after)
  );
}

export function buildScrollTracks(
  events: eventWithTime[],
  timelineStart: number,
  burstStarts: WeakSet<ReplayIncrementalData>,
) {
  const tracks = new Map<number, ScrollTrack>();
  for (const event of events) {
    const data = incrementalData(event);
    if (
      !data ||
      data.source !== REPLAY_SOURCE.Scroll ||
      typeof data.id !== 'number'
    )
      continue;
    let track = tracks.get(data.id);
    if (!track) {
      track = { id: data.id, burst: -1, points: [] };
      tracks.set(data.id, track);
    }
    if (burstStarts.has(data) || track.burst < 0) track.burst += 1;
    track.points.push({
      t: event.timestamp - timelineStart,
      x: typeof data.x === 'number' ? data.x : 0,
      y: typeof data.y === 'number' ? data.y : 0,
      burst: track.burst,
      mx: 0,
      my: 0,
    });
  }
  for (const track of tracks.values()) {
    for (let index = 0; index < track.points.length; index += 1) {
      track.points[index].mx = scrollTangent(track.points, index, 'x');
      track.points[index].my = scrollTangent(track.points, index, 'y');
    }
  }
  return tracks;
}

export function scrollPositionAt(
  track: ScrollTrack,
  time: number,
  clicks: DirectedClick[],
  ease: (progress: number) => number,
): { x: number; y: number } | null {
  const points = track.points;
  let index = -1;
  for (let candidate = 0; candidate < points.length; candidate += 1) {
    if (points[candidate].t <= time) index = candidate;
    else break;
  }
  if (index < 0) return null;
  const from = points[index];
  const to = points[index + 1];
  if (to && to.burst !== from.burst) {
    const afterTo = points[index + 2];
    const singletonBurst = !afterTo || afterTo.burst !== to.burst;
    let start = Math.max(from.t, to.t - 450);
    for (const click of clicks) {
      if (click.t > start && click.t < to.t) start = click.t;
    }
    if (singletonBurst && time >= start) {
      const progress = Math.max(
        0,
        Math.min(1, (time - start) / Math.max(1, to.t - start)),
      );
      const eased = ease(progress);
      return {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      };
    }
  }
  if (!to || to.burst !== from.burst || time >= to.t)
    return { x: from.x, y: from.y };
  const span = Math.max(1, to.t - from.t);
  const progress = Math.max(0, Math.min(1, (time - from.t) / span));
  const squared = progress * progress;
  const cubed = squared * progress;
  const h00 = 2 * cubed - 3 * squared + 1;
  const h10 = cubed - 2 * squared + progress;
  const h01 = -2 * cubed + 3 * squared;
  const h11 = cubed - squared;
  return {
    x: h00 * from.x + h10 * span * from.mx + h01 * to.x + h11 * span * to.mx,
    y: h00 * from.y + h10 * span * from.my + h01 * to.y + h11 * span * to.my,
  };
}

export function replaceNativeScrollEvents(
  events: eventWithTime[],
): eventWithTime[] {
  return events.map((event) =>
    eventSource(event) === REPLAY_SOURCE.Scroll
      ? ({
          ...event,
          type: REPLAY_EVENT.Custom,
          data: { tag: 'gt-directed-scroll', payload: null },
        } as eventWithTime)
      : event,
  );
}
