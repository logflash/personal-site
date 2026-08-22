import type { GTReplayerBundle } from 'gt-rrweb/replay'

/**
 * Parse a dropped file's text into a replayer bundle. Accepts the two shapes a
 * gt-rrweb recording downloads as: the full bundle ({ events, locales, overlay })
 * or a raw rrweb events array. Returns null for anything else — the drop targets
 * treat that as an invalid recording and refresh the page.
 */
// A playable event stream: ≥2 entries that look like rrweb events. Without the
// shape check, any JSON array (e.g. [1, 2, 3]) would count as a recording and
// open a broken player instead of triggering the invalid-drop refresh.
function isEventStream(events: unknown): events is GTReplayerBundle['events'] {
  return (
    Array.isArray(events) &&
    events.length >= 2 &&
    events.every(
      (event) =>
        !!event &&
        typeof event === 'object' &&
        typeof (event as { type?: unknown }).type === 'number',
    )
  )
}

export function parseRecording(text: string): GTReplayerBundle | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (isEventStream(parsed)) return { events: parsed }
  if (parsed && typeof parsed === 'object') {
    const bundle = parsed as { events?: unknown }
    if (isEventStream(bundle.events)) return parsed as GTReplayerBundle
  }
  return null
}
