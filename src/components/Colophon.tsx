import { useState } from 'react'
import { flushSync } from 'react-dom'
import { msg } from 'gt-react'
import { beginFontMorph, prepareFontMorph } from '../lib/fontMorph'
import { useLocale, useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'
import { SUPPORTED_LOCALES } from '../lib/localePath'
import { useRecordingRuntime } from '../hooks/useRecordingRuntime'
import { useRememberedDisclosure } from '../hooks/usePageMemory'
import { pageScroller } from '../lib/pageScroll'

export const colophonMessages = [
  msg('About this site'),
  msg('Glyphs in motion'),
  msg('Change typeface'),
  msg(
    'The same words, a different font. Glyphflux connects the sans-serif links to serif page headings.',
  ),
  msg('A site you can replay'),
  msg('Record a short visit, then replay it in English, Spanish, or Japanese with gt-rrweb.'),
]

function Copy({ text }: { text: string }) {
  const gt = useTranslate()
  return <span data-_gt-hash={translationHash(text)}>{gt(text)}</span>
}

function TypeSpecimen() {
  const gt = useTranslate()
  const [serif, setSerif] = useState(false)
  const [busy, setBusy] = useState(false)
  const change = async () => {
    if (busy) return
    // Reduced motion needs only the native endpoint, so it must not wait for
    // an unused animation pair to be fetched or decoded on the first tap.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSerif((value) => !value)
      return
    }
    setBusy(true)
    try {
      await prepareFontMorph('colophon-specimen')
    } catch {
      // Exact DOM text remains usable when preparation is unavailable.
    }
    beginFontMorph('colophon-specimen')
    flushSync(() => setSerif((value) => !value))
    setBusy(false)
  }
  return (
    <button
      type="button"
      className="type-specimen"
      title={gt('Change typeface')}
      onClick={() => void change()}
      disabled={busy}
    >
      <span className="type-specimen-stage">
        <span
          key={String(serif)}
          data-font-morph="colophon-specimen"
          data-_gt-hash={translationHash('Projects')}
          className={serif ? 'specimen-serif' : 'specimen-sans'}
        >
          {gt('Projects')}
        </span>
      </span>
      <span className="type-specimen-caption">
        <span className="type-specimen-instruction">
          <Copy text="Change typeface" />
        </span>
        <svg
          className="type-specimen-arrow"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3" />
        </svg>
      </span>
    </button>
  )
}

export function Colophon() {
  const entry = useRememberedDisclosure('colophon')
  const locale = useLocale()
  const { start, status } = useRecordingRuntime()
  const reveal = () => {
    if (entry.current?.open) return
    // Let the native summary action expand first. Only direct activation
    // scrolls; restoring the disclosure during navigation keeps its saved place.
    requestAnimationFrame(() => {
      if (!entry.current?.open) return
      const scroller = pageScroller()
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
    })
  }
  return (
    <details ref={entry} data-reading-anchor="colophon" className="colophon">
      <summary onClick={reveal}>
        <Copy text="About this site" />
      </summary>
      <div className="colophon-grid">
        <section>
          <h3>
            <Copy text="Glyphs in motion" />
          </h3>
          <p>
            <Copy text="The same words, a different font. Glyphflux connects the sans-serif links to serif page headings." />
          </p>
          <TypeSpecimen />
          <a
            className="colophon-source"
            href="https://github.com/logflash/glyphflux"
            target="_blank"
            rel="noreferrer"
          >
            Glyphflux ↗
          </a>
        </section>
        <section>
          <h3>
            <Copy text="A site you can replay" />
          </h3>
          <p>
            <Copy text="Record a short visit, then replay it in English, Spanish, or Japanese with gt-rrweb." />
          </p>
          <button
            className="colophon-record"
            type="button"
            disabled={status !== 'idle'}
            onClick={() => start([locale, ...SUPPORTED_LOCALES.filter((item) => item !== locale)])}
          >
            <span className="record-dot" aria-hidden="true" />
            <Copy text="Start recording" />
          </button>
          <a
            className="colophon-source"
            href="https://github.com/logflash/personal-site/tree/main/repos/gt-rrweb"
            target="_blank"
            rel="noreferrer"
          >
            gt-rrweb ↗
          </a>
        </section>
      </div>
    </details>
  )
}
