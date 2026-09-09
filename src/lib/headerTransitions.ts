export interface HeaderTransition {
  /** Stable semantic identity shared by every source and destination heading. */
  key: string
}

/**
 * Declares a reusable heading transition. Keeping the identity in one object
 * prevents links, MDX headings, live animation, and replay from drifting onto
 * different string keys as more standalone pages are added.
 */
export function defineHeaderTransition(key: string): Readonly<HeaderTransition> {
  return Object.freeze({ key })
}

export const resumeHeaderTransition = defineHeaderTransition('resume-title')
