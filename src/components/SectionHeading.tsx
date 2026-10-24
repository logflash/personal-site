import { Link } from '@tanstack/react-router'
import { useBackToTop } from '../hooks/useHashRoute'
import { useScrolled } from '../hooks/useScrolled'
import { useTranslate } from '../lib/i18n'

interface SectionHeadingProps {
  id: string
  title: string
  /** Source-message hash used by gt-rrweb when a recording starts in any locale. */
  translationHash?: string
  /** Research/Projects use a tighter bottom margin than About/Contact. */
  tight?: boolean
  level?: 2 | 3
}

/**
 * Section h2 with a hash anchor that fades in on hover (desktop only).
 * On mobile, the heading itself is a link that sets the hash route and
 * scrolls to the section, and a chevron appears once the page is
 * scrolled, jumping back to the top.
 */
export function SectionHeading({
  id,
  title,
  translationHash,
  tight,
  level = 2,
}: SectionHeadingProps) {
  const Heading = level === 3 ? 'h3' : 'h2'
  const gt = useTranslate()
  const scrolled = useScrolled()
  const backToTop = useBackToTop()

  return (
    <div className={tight ? 'h-row tight' : 'h-row'}>
      <Link
        className="hash"
        to="."
        hash={id}
        activeOptions={{ includeHash: true }}
        aria-label={title}
      >
        #
      </Link>
      <Heading {...(translationHash ? { 'data-_gt-hash': translationHash } : {})}>
        <Link className="h-link" to="." hash={id} activeOptions={{ includeHash: true }}>
          {title}
        </Link>
      </Heading>
      {scrolled && (
        <button
          type="button"
          className="heading-control back-to-top"
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
