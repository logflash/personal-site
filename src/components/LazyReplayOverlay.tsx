import type { GTReplayerBundle } from 'gt-rrweb/replay'
import { lazy, Suspense } from 'react'

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
  return (
    <Suspense fallback={<div className="replay-overlay" aria-busy="true" />}>
      <ReplayOverlay bundle={bundle} initialLocale={initialLocale} onClose={onClose} />
    </Suspense>
  )
}
