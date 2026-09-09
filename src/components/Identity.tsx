import type { GTReplayerBundle } from 'gt-rrweb/replay'
import type { DragEvent, MouseEvent, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { profile } from '../data/site'
import { useRecordingRuntime } from '../hooks/useRecordingRuntime'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localeFromPath } from '../lib/localePath'
import { parseRecording } from '../lib/recordingDrop'
import { useLocale } from '../lib/i18n'
import { LazyReplayOverlay } from './LazyReplayOverlay'

/** Hold duration before the avatar gesture starts a localized recording. */
const HOLD_MS = 1000
/** Ignore ordinary taps before loading the comparatively heavy recorder runtime. */
const PREPARE_DELAY_MS = 150

/**
 * Avatar + name + handle, laid out by the parent container.
 *
 * The avatar doubles as a hidden recording trigger: press and hold for one
 * second (a progress ring charges around it) to put the site into gt-rrweb
 * recording mode. The current locale is recorded as the source; the bundle
 * opens directly in the replay overlay on stop (see RecordingRuntime), where
 * it can still be downloaded as JSON.
 *
 * It is also the replay drop target: drop a recording JSON on it to open a
 * replay overlay (debug mode — another drop on the box swaps the replay);
 * drop a file that isn't a recording and the page refreshes.
 */
export function Identity({ renderWho }: { renderWho?: (who: ReactNode) => ReactNode } = {}) {
  const currentLocale = useLocale()
  const { status, prepare, start } = useRecordingRuntime()
  const [charging, setCharging] = useState(false)
  const [dropReady, setDropReady] = useState(false)
  const [replay, setReplay] = useState<GTReplayerBundle | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prepareTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancelHold = () => {
    clearTimeout(holdTimer.current)
    clearTimeout(prepareTimer.current)
    setCharging(false)
  }

  const beginHold = () => {
    if (status !== 'idle') return
    setCharging(true)
    prepareTimer.current = setTimeout(prepare, PREPARE_DELAY_MS)
    holdTimer.current = setTimeout(() => {
      setCharging(false)
      const locale = localeFromPath(window.location.pathname) ?? currentLocale ?? DEFAULT_LOCALE
      start([locale, ...SUPPORTED_LOCALES.filter((l) => l !== locale)])
    }, HOLD_MS)
  }

  // On mobile the avatar sits inside the identity's back-to-top link. The
  // avatar itself exclusively owns the recording gesture: a tap or completed
  // hold must never activate that surrounding link.
  const suppressAvatarActivation = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  // Drop a recording JSON on the avatar to replay it; anything else refreshes.
  const onDrop = (event: DragEvent<HTMLSpanElement>) => {
    event.preventDefault()
    setDropReady(false)
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    void file.text().then(
      (text) => {
        const bundle = parseRecording(text)
        if (bundle) setReplay(bundle)
        else window.location.reload()
      },
      () => window.location.reload(),
    )
  }

  const avatarClass = ['avatar-hold', charging && 'charging', dropReady && 'drop-ready']
    .filter(Boolean)
    .join(' ')
  const who = (
    <div className="who">
      <span className="name">{profile.name}</span>
      <span className="handle">{profile.handle}</span>
    </div>
  )

  return (
    <>
      <span
        className={avatarClass}
        onPointerDown={beginHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={suppressAvatarActivation}
        onClickCapture={suppressAvatarActivation}
        onDragOver={(event) => {
          event.preventDefault()
          setDropReady(true)
        }}
        onDragLeave={() => setDropReady(false)}
        onDrop={onDrop}
      >
        <img className="avatar" src={profile.avatarSmall} alt={profile.name} draggable={false} />
        <svg className="avatar-ring" viewBox="0 0 48 48" aria-hidden="true">
          <circle className="ring-track" cx="24" cy="24" r="23" />
          <circle className="ring-progress" cx="24" cy="24" r="23" pathLength={100} />
        </svg>
      </span>
      {renderWho ? renderWho(who) : who}
      {replay
        ? createPortal(
            <LazyReplayOverlay
              bundle={replay}
              initialLocale={
                localeFromPath(window.location.pathname) ?? currentLocale ?? DEFAULT_LOCALE
              }
              onClose={() => setReplay(null)}
            />,
            document.body,
          )
        : null}
    </>
  )
}
