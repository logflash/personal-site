import { createContext, useContext } from 'react'

export type RecordingRuntimeStatus = 'idle' | 'loading' | 'preparing' | 'recording'

export interface RecordingRequest {
  id: number
  locales: string[]
}

export interface RecordingRuntimeControls {
  status: RecordingRuntimeStatus
  /** Begin fetching the recorder chunk without starting a recording. */
  prepare: () => void
  /** Start now, or as soon as the recorder chunk has loaded. */
  start: (locales: string[]) => void
}

export const RecordingRuntimeContext = createContext<RecordingRuntimeControls | null>(null)

export function useRecordingRuntime(): RecordingRuntimeControls {
  const controls = useContext(RecordingRuntimeContext)
  if (!controls) throw new Error('useRecordingRuntime must be used inside RecordingRuntimeContext')
  return controls
}
