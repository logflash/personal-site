import { Fragment, useLayoutEffect, useRef } from 'react'
import { profile } from '../data/site'
import { fitPublicationAuthors } from '../lib/publicationAuthors'

export function PublicationAuthors({ id, authors }: { id: string; authors: readonly string[] }) {
  const container = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const row = container.current
    if (!row) return
    fitPublicationAuthors()
    const observer = new ResizeObserver(fitPublicationAuthors)
    observer.observe(row)
    // Intrinsic width changes when a web font loads, even if the card doesn't resize.
    const options = row.querySelector('.publication-entry-authors-options')
    if (options) observer.observe(options)
    return () => observer.disconnect()
  }, [authors, id])

  // SSR includes every whole-name option. Parser-time layout selects a row
  // through a body CSS variable, so hydration never replaces the author text.
  const options = [
    ...Array.from({ length: Math.max(0, authors.length - 2) }, (_, index) => [
      ...authors.slice(0, index + 1),
      '…',
      authors.at(-1)!,
    ]),
    authors,
  ]
  return (
    <span
      ref={container}
      className="publication-entry-authors"
      data-author-key={id}
      title={authors.join(', ')}
    >
      <span className="sr-only">{authors.join(', ')}</span>
      <span
        className="publication-entry-authors-options"
        aria-hidden="true"
        style={{ transform: `translateY(calc(var(--publication-authors-${id}, 0) * -1.6em))` }}
      >
        {options.map((option, index) => (
          <span key={index} data-author-option="">
            {option.map((author, position) => (
              <Fragment key={author}>
                {position > 0 ? ', ' : ''}
                <span>{author === profile.name ? <strong>{author}</strong> : author}</span>
              </Fragment>
            ))}
          </span>
        ))}
      </span>
    </span>
  )
}
