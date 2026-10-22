import { useLayoutEffect, useRef, useState } from 'react'
import { msg } from 'gt-react'
import { publications } from '../data/publications'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'
import { copyText } from '../lib/copyText'

export const citationMessages = [
  msg('Copy citation'),
  msg('Copy BibTeX'),
  msg('Copy link'),
  msg('Copied!'),
  msg('Select and copy the text below'),
  msg('Citation'),
]

export function PublicationTools({ publicationId }: { publicationId: keyof typeof publications }) {
  const gt = useTranslate()
  const [format, setFormat] = useState<'citation' | 'bibtex' | 'link'>('citation')
  const [status, setStatus] = useState('')
  const [link, setLink] = useState('')
  const output = useRef<HTMLTextAreaElement>(null)
  const pendingCopy = useRef(0)
  const publication = publications[publicationId]
  const value = format === 'link' ? link : publication[format]

  // Run after React mounts the fallback. A queued animation frame can precede
  // that commit after a touch click in Firefox, leaving the text unfocused.
  useLayoutEffect(() => {
    if (status !== 'Select and copy the text below') return
    output.current?.focus({ preventScroll: true })
    output.current?.select()
  })

  const copy = async (next: typeof format) => {
    const request = ++pendingCopy.current
    const url = new URL(window.location.href)
    url.hash = publicationId
    const text = next === 'link' ? url.href : publication[next]
    setFormat(next)
    setLink(url.href)
    setStatus('')
    try {
      await copyText(text)
      if (request === pendingCopy.current) setStatus('Copied!')
    } catch {
      if (request !== pendingCopy.current) return
      setStatus('Select and copy the text below')
      // The text remains available if clipboard permissions are denied.
    }
  }

  return (
    <div className="publication-tools">
      <div className="publication-actions">
        {(
          [
            ['citation', 'Copy citation'],
            ['bibtex', 'Copy BibTeX'],
            ['link', 'Copy link'],
          ] as const
        ).map(([key, label]) => (
          <button type="button" key={key} onClick={() => void copy(key)}>
            <span data-_gt-hash={translationHash(label)}>{gt(label)}</span>
          </button>
        ))}
      </div>
      {status === 'Select and copy the text below' && (
        <textarea
          ref={output}
          className="citation-text"
          aria-label={
            format === 'bibtex' ? 'BibTeX' : gt(format === 'link' ? 'Copy link' : 'Citation')
          }
          readOnly
          value={value}
          rows={format === 'bibtex' ? 10 : 4}
          spellCheck={false}
        />
      )}
      <span className="copy-status" role="status" aria-live="polite">
        {status && <span data-_gt-hash={translationHash(status)}>{gt(status)}</span>}
      </span>
    </div>
  )
}
