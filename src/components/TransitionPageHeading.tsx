import { useState, type ReactNode } from 'react'
import { useFontMorphNavigation } from '../hooks/useFontMorphNavigation'
import type { HeaderTransition } from '../lib/headerTransitions'

export type HeaderTransitionHandlers = ReturnType<typeof useFontMorphNavigation>

/** Curved return arrow shared by desktop's inline control and mobile's circle. */
export function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

/**
 * A route-level heading whose text participates in a font morph and whose
 * adjacent action follows that morph's semantic lifecycle. The action is
 * present in the DOM throughout, so rrweb records stable structure; CSS uses
 * the director's active/fallback attributes to reveal it only on settled
 * frames, including transitions that settle early outside the viewport.
 */
export function TransitionPageHeading({
  transition,
  title,
  translationHash,
  renderAction,
}: {
  transition: HeaderTransition
  title: string
  translationHash?: string
  renderAction: (handlers: HeaderTransitionHandlers) => ReactNode
}) {
  const handlers = useFontMorphNavigation(transition.key)
  const [actionHovered, setActionHovered] = useState(false)

  return (
    <div
      className="transition-page-heading"
      data-transition-heading={transition.key}
      onPointerEnter={() => setActionHovered(true)}
      onPointerLeave={() => setActionHovered(false)}
    >
      <span
        className="transition-page-heading-action"
        data-transition-action={transition.key}
        data-transition-action-hovered={actionHovered ? '' : undefined}
      >
        {renderAction(handlers)}
      </span>
      <h1
        className="transition-page-title"
        data-font-morph={transition.key}
        {...(translationHash ? { 'data-_gt-hash': translationHash } : {})}
      >
        {title}
      </h1>
    </div>
  )
}
