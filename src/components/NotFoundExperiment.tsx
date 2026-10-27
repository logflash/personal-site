import { useState } from 'react'
import { flushSync } from 'react-dom'
import { beginFontMorph, prepareFontMorph } from '../lib/fontMorph'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'

/** Local, opt-in typography experiment; see NotFoundPage's preview gate. */
export function NotFoundExperiment() {
  const gt = useTranslate()
  const [serif, setSerif] = useState(true)
  const [busy, setBusy] = useState(false)
  const change = async () => {
    if (busy) return
    setBusy(true)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try {
        await prepareFontMorph('not-found-specimen')
      } catch {
        // The typography still switches if the optional renderer is unavailable.
      }
      beginFontMorph('not-found-specimen')
    }
    flushSync(() => setSerif((value) => !value))
    setBusy(false)
  }

  return (
    <button
      type="button"
      className="not-found-specimen"
      onClick={() => void change()}
      disabled={busy}
      aria-label={gt('Change typeface')}
    >
      <span className="not-found-specimen-stage" aria-hidden="true">
        <span
          key={String(serif)}
          data-font-morph="not-found-specimen"
          className={serif ? 'not-found-serif' : 'not-found-sans'}
        >
          404
        </span>
      </span>
      <span className="not-found-specimen-caption">
        <span data-_gt-hash={translationHash('Change typeface')}>{gt('Change typeface')}</span>
        <span aria-hidden="true">↔</span>
      </span>
    </button>
  )
}
