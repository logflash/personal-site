'use client';

import type { eventWithTime } from '@rrweb/types';
import {
  SETTLED_TEXT_HOLD_MS,
  createFontMorphFrameRenderer,
  prepareFontMorphFrames,
  type FontMorphCaptureFrame,
  type FontMorphRecording,
} from 'font-morph';

import { REPLAY_EVENT, REPLAY_SOURCE } from './replay/director';
import type { GTReplayerFrame } from './replay/player';

export type MorphTextResolver = (
  locale: string | undefined,
  translationHash: string | undefined,
  recordedText: string,
) => string | undefined;

type FontMorphCustomEvent = eventWithTime & {
  data: { tag?: string; payload?: FontMorphRecording };
};

type IndexedFontMorph = {
  event: FontMorphCustomEvent;
  payload: FontMorphRecording;
  activationTimestamp: number;
};

const indexedMorphCache = new WeakMap<eventWithTime[], IndexedFontMorph[]>();

function isFontMorphTag(tag: string | undefined): boolean {
  return tag === 'font-morph' || tag === 'gt-font-morph';
}

function recordedActivationTimestamp(
  events: eventWithTime[],
  eventIndex: number,
  payload: FontMorphRecording,
): number {
  for (let index = eventIndex - 1; index >= 0; index -= 1) {
    const candidate = events[index] as eventWithTime & {
      data?: {
        source?: number;
        attributes?: { attributes?: Record<string, string | null> }[];
      };
    };
    if (
      candidate.type === REPLAY_EVENT.IncrementalSnapshot &&
      candidate.data?.source === REPLAY_SOURCE.Mutation &&
      candidate.data.attributes?.some(
        (change) =>
          change.attributes?.['data-font-morph-active'] === payload.key,
      )
    ) {
      return candidate.timestamp;
    }
  }

  return events[eventIndex].timestamp - Math.max(0, payload.leadIn ?? 0);
}

function indexFontMorphs(events: eventWithTime[]): IndexedFontMorph[] {
  let cached = indexedMorphCache.get(events);
  if (cached) return cached;
  cached = events.flatMap((event, eventIndex) => {
    const customEvent = event as FontMorphCustomEvent;
    const payload = customEvent.data?.payload;
    return customEvent.type === REPLAY_EVENT.Custom &&
      isFontMorphTag(customEvent.data?.tag) &&
      payload?.version === 2 &&
      Number.isFinite(payload.duration) &&
      payload.duration > 0
      ? [
          {
            event: customEvent,
            payload,
            activationTimestamp: recordedActivationTimestamp(
              events,
              eventIndex,
              payload,
            ),
          },
        ]
      : [];
  });
  indexedMorphCache.set(events, cached);
  return cached;
}

function settledTextHold(payload: FontMorphRecording): number {
  return Number.isFinite(payload.settledTextHold) &&
    (payload.settledTextHold ?? -1) >= 0
    ? payload.settledTextHold!
    : SETTLED_TEXT_HOLD_MS;
}

/** Add a deterministic destination-reading hold to legacy font-morph events. */
export function reserveFontMorphSettledTextHolds<Event extends eventWithTime>(
  events: Event[],
): Event[];
export function reserveFontMorphSettledTextHolds<Event extends eventWithTime>(
  events: Event[],
): Event[] {
  let changed = false;
  const prepared = events.map((event) => {
    const customEvent = event as Event & FontMorphCustomEvent;
    const payload = customEvent.data?.payload;
    if (
      customEvent.type !== REPLAY_EVENT.Custom ||
      !isFontMorphTag(customEvent.data?.tag) ||
      payload?.version !== 2 ||
      (Number.isFinite(payload.settledTextHold) &&
        (payload.settledTextHold ?? -1) >= 0)
    ) {
      return event;
    }
    changed = true;
    return {
      ...customEvent,
      data: {
        ...customEvent.data,
        payload: { ...payload, settledTextHold: SETTLED_TEXT_HOLD_MS },
      },
    } as Event;
  });
  return changed ? prepared : events;
}

type ActiveFontMorph = IndexedFontMorph & {
  activationStart: number;
  start: number;
  end: number;
  holdEnd: number;
};

function recordedMorphAt(frame: GTReplayerFrame): ActiveFontMorph | null {
  const firstTimestamp = frame.events[0]?.timestamp ?? 0;
  const morphs = indexFontMorphs(frame.events);
  for (let index = morphs.length - 1; index >= 0; index -= 1) {
    const indexed = morphs[index];
    const activationStart = indexed.activationTimestamp - firstTimestamp;
    const start = indexed.event.timestamp - firstTimestamp;
    const end = start + indexed.payload.duration;
    const holdEnd = end + settledTextHold(indexed.payload);
    if (frame.time >= activationStart && frame.time < holdEnd) {
      return { ...indexed, activationStart, start, end, holdEnd };
    }
  }
  return null;
}

function recordedCaptureFrame(events: eventWithTime[]): FontMorphCaptureFrame {
  type SerializedNode = {
    tagName?: string;
    attributes?: Record<string, string>;
    childNodes?: SerializedNode[];
  };
  const visit = (node: SerializedNode | undefined): number | undefined => {
    if (!node) return undefined;
    if (node.tagName === 'html') {
      const match = node.attributes?.style?.match(
        /--gt-capture-height-ratio:\s*([\d.]+)/,
      );
      const ratio = Number.parseFloat(match?.[1] ?? '');
      if (Number.isFinite(ratio) && ratio > 0) return ratio;
    }
    for (const child of node.childNodes ?? []) {
      const ratio = visit(child);
      if (ratio) return ratio;
    }
    return undefined;
  };

  const metadata = events.find((event) => event.type === REPLAY_EVENT.Meta)
    ?.data as { width?: number; height?: number } | undefined;
  const logicalWidth =
    metadata?.width && metadata.width > 0 ? metadata.width : 1_000;
  for (const event of events) {
    if (event.type !== REPLAY_EVENT.FullSnapshot) continue;
    const ratio = visit(
      (event.data as unknown as { node?: SerializedNode }).node,
    );
    if (ratio) {
      return {
        screen: { left: 0, top: 0, width: 1_000, height: 1_000 * ratio },
        logicalWidth,
        logicalHeight: logicalWidth * ratio,
      };
    }
  }
  const ratio =
    metadata?.width && metadata.height
      ? metadata.height / metadata.width
      : 1;
  return {
    screen: { left: 0, top: 0, width: 1_000, height: 1_000 * ratio },
    logicalWidth,
    logicalHeight: logicalWidth * ratio,
  };
}

function resolveRecordedText(
  payload: FontMorphRecording,
  locale: string | undefined,
  resolveText?: MorphTextResolver,
): string {
  const translationHash =
    payload.source.translationHash ?? payload.target.translationHash;
  return (
    resolveText?.(locale, translationHash, payload.source.text) ??
    payload.source.text
  );
}

/** Prepare all locale-specific geometry referenced by an rrweb event stream. */
export async function prepareFontMorphReplay(
  events: eventWithTime[],
  locales: readonly (string | undefined)[],
  resolveText: MorphTextResolver,
  ownerDocument: Document,
): Promise<void> {
  const captureFrame = recordedCaptureFrame(events);
  const preparations = indexFontMorphs(events).flatMap(({ payload }) =>
    locales.map((locale) => ({
      payload,
      text: resolveRecordedText(payload, locale, resolveText),
      captureFrame,
    })),
  );
  await prepareFontMorphFrames(preparations, ownerDocument);
}

/**
 * Drive font-morph from gt-rrweb's absolute replay clock. Locale cuts, holds,
 * seeking, and invisible-animation advancement stay in the replay package.
 */
export function createFontMorphReplayDirector(
  resolveText?: MorphTextResolver,
) {
  const renderFrame = createFontMorphFrameRenderer();
  let state:
    | {
        event: FontMorphCustomEvent;
        document: Document;
        locale?: string;
        lastTime: number;
      }
    | undefined;

  const clear = (document: Document | null): void => {
    renderFrame({
      document,
      payload: null,
      text: '',
      progress: 0,
      phase: 'idle',
      overlayRoot: null,
    });
    state = undefined;
  };

  return (frame: GTReplayerFrame): void | { advanceTo: number } => {
    if (!frame.document) {
      clear(null);
      return;
    }
    if (state && frame.time < state.lastTime) clear(frame.document);

    const active = recordedMorphAt(frame);
    if (!active) {
      clear(frame.document);
      return;
    }

    const text = resolveRecordedText(active.payload, frame.locale, resolveText);
    if (frame.time >= active.end) {
      state = undefined;
      const result = renderFrame({
        document: frame.document,
        payload: active.payload,
        text,
        progress: 1,
        phase: 'settled',
        overlayRoot: frame.overlayRoot,
      });
      return result?.destinationVisible ? undefined : { advanceTo: active.holdEnd };
    }

    if (
      state &&
      state.event === active.event &&
      state.document === frame.document &&
      state.locale !== frame.locale
    ) {
      renderFrame({
        document: frame.document,
        payload: active.payload,
        text,
        progress: 1,
        phase: 'settled',
        overlayRoot: frame.overlayRoot,
      });
      state = undefined;
      return { advanceTo: active.end };
    }

    state = {
      event: active.event,
      document: frame.document,
      locale: frame.locale,
      lastTime: frame.time,
    };
    const result = renderFrame({
      document: frame.document,
      payload: active.payload,
      text,
      progress: (frame.time - active.start) / active.payload.duration,
      phase: 'active',
      overlayRoot: frame.overlayRoot,
    });
    return result?.completedEarly ? { advanceTo: active.holdEnd } : undefined;
  };
}
