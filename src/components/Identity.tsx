import { useRecorder } from 'gt-rrweb'
import type { GTReplayerBundle } from 'gt-rrweb/replay'
import type { DragEvent, MouseEvent } from 'react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { profile } from '../data/site'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localeFromPath } from '../lib/localePath'
import { parseRecording } from '../lib/recordingDrop'
import { ReplayOverlay } from './ReplayOverlay'

/** Hold duration before the avatar gesture starts a localized recording. */
const HOLD_MS = 1000

/**
 * Avatar + name + handle, laid out by the parent container.
 *
 * The avatar doubles as a hidden recording trigger: press and hold for one
 * second (a progress ring charges around it) to put the site into gt-rrweb
 * recording mode. The current locale is recorded as the source; the bundle
 * opens directly in the replay overlay on stop (see the GTRecorder mount in
 * __root), where it can still be downloaded as JSON.
 *
 * It is also the replay drop target: drop a recording JSON on it to open a
 * replay overlay (debug mode — another drop on the box swaps the replay);
 * drop a file that isn't a recording and the page refreshes.
 */
export function Identity() {
  const { status, start } = useRecorder()
  const [charging, setCharging] = useState(false)
  const [dropReady, setDropReady] = useState(false)
  const [replay, setReplay] = useState<GTReplayerBundle | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const justCharged = useRef(false)

  const cancelHold = () => {
    clearTimeout(holdTimer.current)
    setCharging(false)
  }

  const beginHold = () => {
    if (status !== 'idle') return
    justCharged.current = false
    setCharging(true)
    holdTimer.current = setTimeout(() => {
      setCharging(false)
      justCharged.current = true
      const locale = localeFromPath(window.location.pathname) ?? DEFAULT_LOCALE
      void start({ locales: [locale, ...SUPPORTED_LOCALES.filter((l) => l !== locale)] })
    }, HOLD_MS)
  }

  // A completed hold releases over the avatar, which on mobile sits inside
  // the header's back-to-top link — swallow that click so starting a
  // recording doesn't also scroll the page.
  const swallowClick = (event: MouseEvent) => {
    if (!justCharged.current) return
    justCharged.current = false
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

  return (
    <>
      <span
        className={avatarClass}
        onPointerDown={beginHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(event) => event.preventDefault()}
        onClickCapture={swallowClick}
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
      <div className="who">
        <span className="name">{profile.name}</span>
        <span className="handle">{profile.handle}</span>
      </div>
      {replay
        ? createPortal(
            <ReplayOverlay
              bundle={replay}
              initialLocale={localeFromPath(window.location.pathname) ?? DEFAULT_LOCALE}
              onClose={() => setReplay(null)}
            />,
            document.body,
          )
        : null}
    </>
  )
}
