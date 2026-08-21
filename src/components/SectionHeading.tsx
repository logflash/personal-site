import { useGT } from 'gt-react'
import { useBackToTop } from '../hooks/useHashRoute'
import { useScrolled } from '../hooks/useScrollSpy'

interface SectionHeadingProps {
  id: string
  title: string
  /** Research/Projects use a tighter bottom margin than About/Contact. */
  tight?: boolean
}

/**
 * Section h2 with a hash anchor that fades in on hover (desktop only).
 * On mobile, the heading itself is a link that sets the hash route and
 * scrolls to the section, and a chevron appears once the page is
 * scrolled, jumping back to the top.
 */
export function SectionHeading({ id, title, tight }: SectionHeadingProps) {
  const gt = useGT()
  const scrolled = useScrolled()
  const backToTop = useBackToTop()

  return (
    <div className={tight ? 'h-row tight' : 'h-row'}>
      <a className="hash" href={`#${id}`} aria-label={title}>
        #
      </a>
      <h2>
        <a className="h-link" href={`#${id}`}>
          {title}
        </a>
      </h2>
      {scrolled && (
        <button
          type="button"
          className="back-to-top"
          title={gt('Back to top')}
          aria-label={gt('Back to top')}
          onClick={backToTop}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.5 7.5 6 4l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
