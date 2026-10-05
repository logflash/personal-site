import type { GTReplayerBundle } from 'gt-rrweb/replay'
import type { DragEvent } from 'react'
import { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { useTranslate } from '../lib/i18n'
import { parseRecording } from '../lib/recordingDrop'

const ReplayOverlay = lazy(() =>
  import('./ReplayOverlay').then((module) => ({ default: module.ReplayOverlay })),
)

export function LazyReplayOverlay({
  bundle,
  initialLocale,
  onClose,
}: {
  bundle: GTReplayerBundle
  initialLocale?: string
  onClose: () => void
}) {
  const gt = useTranslate()
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Own drops at the full-screen dialog boundary, including its backdrop and
  // loading state. The player's debug listener still handles valid replacements.
  const validateDrop = (event: DragEvent<HTMLDialogElement>) => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    void file.text().then(
      (text) => {
        if (!parseRecording(text)) window.location.reload()
      },
      () => window.location.reload(),
    )
  }
  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      else
        [...document.querySelectorAll<HTMLElement>('.identity-tools button:not(:disabled)')]
          .find((element) => element.getClientRects().length > 0)
          ?.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={dialogRef}
      className="replay-overlay"
      aria-label={gt('Recording replay')}
      onDragOver={(event) => event.preventDefault()}
      onDropCapture={validateDrop}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button className="replay-close" type="button" onClick={onClose}>
        {gt('Close replay')}
      </button>
      <Suspense
        fallback={
          <div role="status" aria-busy="true">
            {gt('Loading replay')}
          </div>
        }
      >
        <ReplayOverlay bundle={bundle} initialLocale={initialLocale} />
      </Suspense>
    </dialog>
  )
}
