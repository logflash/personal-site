import { GTReplayer } from 'gt-rrweb/replay'
import type { GTReplayerBundle } from 'gt-rrweb/replay'
import type { DragEvent } from 'react'
import { useEffect } from 'react'
import { parseRecording } from '../lib/recordingDrop'

/**
 * Full-screen replay overlay, opened by dropping a recording on the avatar
 * (Identity). The player runs in gt-rrweb debug mode, so dropping another
 * recording JSON anywhere on the box hot-swaps the replay in place. A file
 * that is not a recording refreshes the page. Clicking the backdrop (outside
 * the player box) collapses the overlay.
 */
export function ReplayOverlay({
  bundle,
  initialLocale,
  onClose,
}: {
  bundle: GTReplayerBundle
  initialLocale?: string
  onClose: () => void
}) {
  // Lock page scroll while the overlay is up: the page behind shouldn't move,
  // and hiding its scrollbar lets the full-viewport overlay center the box on
  // the true screen axes (a classic scrollbar otherwise shifts it sideways).
  useEffect(() => {
    const html = document.documentElement
    const previous = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = previous
    }
  }, [])
  // gt-rrweb's own debug listener (on the player box) performs the hot-swap;
  // this capture-phase check adds the site's contract on top: an invalid file
  // dropped on the box or the backdrop reloads the page. Capture runs before
  // the player's swap, but both only act after reading the file, and only one
  // of them acts per drop (swap for recordings, reload for everything else).
  const validateDrop = (event: DragEvent<HTMLDivElement>) => {
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    event.preventDefault() // a backdrop drop must not navigate to the file
    void file.text().then(
      (text) => {
        if (!parseRecording(text)) window.location.reload()
      },
      () => window.location.reload(),
    )
  }

  return (
    <div
      className="replay-overlay"
      onDragOver={(event) => event.preventDefault()}
      onDropCapture={validateDrop}
      // Only genuine backdrop clicks collapse — clicks inside the player box
      // bubble here with a different target.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="replay-overlay-box">
        <GTReplayer bundle={bundle} initialLocale={initialLocale} debug />
      </div>
    </div>
  )
}
