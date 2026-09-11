import { record } from '@rrweb/record'
import { hashMessage } from 'gt-i18n/internal'
import { GT_EVENT, GTRecorder, useRecorder } from 'gt-rrweb'
import type { HarvestOptions, RecorderBundle } from 'gt-rrweb'
import { useEffect, useRef, useState } from 'react'
import type { RecordingRequest, RecordingRuntimeStatus } from '../hooks/useRecordingRuntime'
import loadTranslations from '../loadTranslations'
import { FONT_MORPH_EVENT_TAG, FONT_MORPH_RECORD_EVENT } from '../lib/fontMorph'
import { SKILL_CARD_RECORD_EVENT } from '../lib/skillCardAnimation'

// gt-rrweb harvest: maps the recorded hashes onto each locale's published
// translations via the app's own loader; hashMessage extends coverage to
// gt()/useGT()/msg() strings, which render as bare text with no DOM hash.
const harvest: HarvestOptions = {
  loadTranslations,
  // RecordingRuntime is lazy-loaded after the avatar hold starts, so GT's
  // general-purpose ICU hasher stays out of the initial page bundle.
  hashMessage: (message) => hashMessage(message, { $format: 'ICU' }),
}

const MOBILE_VIEWPORT = '(max-width: 880px)'
const DESKTOP_ASPECT = 16 / 9
const MOBILE_ASPECT = 3 / 4
const MOBILE_FRAME = { aspect: MOBILE_ASPECT } as const
const DESKTOP_LABELS = { rec: 'REC · 16:9' }
const MOBILE_LABELS = { rec: 'REC · 3:4' }

// While recording, global.css scales the whole site (.layout) down into the
// capture frame. The aspect is supplied by ResponsiveRecorder and remains
// fixed for the entire recording.
function CaptureScale({ aspect }: { aspect: number }) {
  useEffect(() => {
    const update = () => {
      const frameWidth = Math.min(0.94 * window.innerWidth, (window.innerHeight - 144) * aspect)
      document.documentElement.style.setProperty(
        '--gt-capture-scale',
        String(frameWidth / window.innerWidth),
      )
      document.documentElement.style.setProperty('--gt-capture-height-ratio', String(1 / aspect))
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--gt-capture-scale')
      document.documentElement.style.removeProperty('--gt-capture-height-ratio')
    }
  }, [aspect])

  return null
}

/** Uses the same breakpoint as the site's mobile layout and locks that choice
 * while recording so the overlay, pointer bounds, and virtual viewport agree. */
function ResponsiveRecorder({ onComplete }: { onComplete: (bundle: RecorderBundle) => void }) {
  const { status } = useRecorder()
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_VIEWPORT).matches)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_VIEWPORT)
    const update = () => {
      if (status === 'idle') setMobile(query.matches)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [status])

  const aspect = mobile ? MOBILE_ASPECT : DESKTOP_ASPECT

  return (
    <>
      <GTRecorder
        contentSelector=".layout"
        frame={mobile ? MOBILE_FRAME : '16:9'}
        expose="gtRecorder"
        harvest={harvest}
        labels={mobile ? MOBILE_LABELS : DESKTOP_LABELS}
        onComplete={onComplete}
      />
      <CaptureScale aspect={aspect} />
    </>
  )
}

/** Bridges a lightweight app request into gt-rrweb after GTRecorder has
 * mounted and configured the package-level recorder core. */
function RuntimeBridge({
  request,
  onStatusChange,
}: {
  request: RecordingRequest | null
  onStatusChange: (status: RecordingRuntimeStatus) => void
}) {
  const { status, start } = useRecorder()
  const handledRequest = useRef(0)

  useEffect(() => onStatusChange(status), [onStatusChange, status])

  useEffect(() => {
    if (!request || request.id === handledRequest.current) return
    handledRequest.current = request.id
    void start({ locales: request.locales })
  }, [request, start])

  return null
}

/** Converts compact, app-authored animation descriptions into rrweb custom
 * events. Per-frame renderer output stays blocked from capture. */
function SemanticEventBridge() {
  useEffect(() => {
    const captureFontMorph = (event: Event) => {
      try {
        record.addCustomEvent(FONT_MORPH_EVENT_TAG, (event as CustomEvent).detail)
      } catch {
        // The animation also runs outside an active recording.
      }
    }
    const captureSkillCardAnimation = (event: Event) => {
      try {
        record.addCustomEvent(GT_EVENT.animation, (event as CustomEvent).detail)
      } catch {
        // The animation also runs outside an active recording.
      }
    }
    window.addEventListener(FONT_MORPH_RECORD_EVENT, captureFontMorph)
    window.addEventListener(SKILL_CARD_RECORD_EVENT, captureSkillCardAnimation)
    return () => {
      window.removeEventListener(FONT_MORPH_RECORD_EVENT, captureFontMorph)
      window.removeEventListener(SKILL_CARD_RECORD_EVENT, captureSkillCardAnimation)
    }
  }, [])

  return null
}

export function RecordingRuntime({
  request,
  onStatusChange,
  onComplete,
}: {
  request: RecordingRequest | null
  onStatusChange: (status: RecordingRuntimeStatus) => void
  onComplete: (bundle: RecorderBundle) => void
}) {
  return (
    <>
      <ResponsiveRecorder onComplete={onComplete} />
      <RuntimeBridge request={request} onStatusChange={onStatusChange} />
      <SemanticEventBridge />
    </>
  )
}
