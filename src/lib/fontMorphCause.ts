export const FONT_MORPH_CAUSE_STORAGE_KEY = 'ian-site-morph-causes-v1'
export type FontMorphCause = 'card' | 'sidebar' | 'topbar'
const fallbackCauses = new Map<string, FontMorphCause>()

export function morphSourceKey(key: string, cause: FontMorphCause) {
  return cause === 'card' ? key : `${key}::${cause}`
}

export function rememberMorphCause(key: string, cause: FontMorphCause) {
  fallbackCauses.set(key, cause)
  try {
    const saved = JSON.parse(sessionStorage.getItem(FONT_MORPH_CAUSE_STORAGE_KEY) ?? '{}')
    sessionStorage.setItem(FONT_MORPH_CAUSE_STORAGE_KEY, JSON.stringify({ ...saved, [key]: cause }))
  } catch {
    /* Navigation still works when storage is unavailable. */
  }
}

export function destinationMorphKey(key: string) {
  if (typeof window === 'undefined') return morphSourceKey(key, 'sidebar')
  let cause = fallbackCauses.get(key)
  try {
    const saved = JSON.parse(sessionStorage.getItem(FONT_MORPH_CAUSE_STORAGE_KEY) ?? '{}')
    if (['card', 'sidebar', 'topbar'].includes(saved[key])) cause = saved[key]
  } catch {
    /* Use the in-memory session when storage is unavailable. */
  }
  // A navigation source follows the responsive layout if the viewport changes.
  // Card sources keep their identity even when scrolled out of view.
  const navigation = window.matchMedia('(max-width: 880px)').matches ? 'topbar' : 'sidebar'
  return morphSourceKey(key, cause === 'card' ? 'card' : navigation)
}
