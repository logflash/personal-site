import { useEffect, useRef, useState } from 'react'
import {
  createFontMorphProgressController,
  type FontMorphProgressController,
} from '../../src/index'
import { SdfApp } from './SdfApp'

const SAMPLES = {
  en: { label: 'English', text: 'Resume', sourceLabel: 'Sans serif', targetLabel: 'Serif' },
  es: { label: 'Español', text: 'Currículum', sourceLabel: 'Sans serif', targetLabel: 'Serif' },
  ja: { label: '日本語', text: '履歴書', sourceLabel: 'Gothic', targetLabel: 'Mincho' },
} as const

type Locale = keyof typeof SAMPLES
type Status = 'loading' | 'ready' | 'error'

function KuteApp() {
  const [locale, setLocale] = useState<Locale>('en')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const sourceRef = useRef<HTMLSpanElement>(null)
  const targetRef = useRef<HTMLSpanElement>(null)
  const controllerRef = useRef<FontMorphProgressController | null>(null)
  const progressRef = useRef(progress)
  const sample = SAMPLES[locale]

  progressRef.current = progress

  useEffect(() => {
    const source = sourceRef.current
    const target = targetRef.current
    if (!source || !target) return

    let cancelled = false
    setStatus('loading')
    setError('')

    void createFontMorphProgressController({
      source,
      target,
      initialProgress: progressRef.current,
    }).then(
      (controller) => {
        if (cancelled) {
          controller.destroy()
          return
        }
        controllerRef.current?.destroy()
        controllerRef.current = controller
        controller.setProgress(progressRef.current)
        setStatus('ready')
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setStatus('error')
      },
    )

    return () => {
      cancelled = true
      controllerRef.current?.destroy()
      controllerRef.current = null
    }
  }, [locale])

  const updateProgress = (value: number) => {
    const next = Math.min(1, Math.max(0, value))
    progressRef.current = next
    setProgress(next)
    controllerRef.current?.setProgress(next)
  }

  const changeLocale = (next: Locale) => {
    updateProgress(0)
    setLocale(next)
  }

  return (
    <main className="demo" data-demo-status={status}>
      <header className="demo-header">
        <div>
          <p className="eyebrow">font-morph</p>
          <h1>Controlled transition</h1>
        </div>
        <label className="locale-control" htmlFor="locale">
          <span>Language</span>
          <select
            id="locale"
            value={locale}
            onChange={(event) => changeLocale(event.target.value as Locale)}
          >
            {Object.entries(SAMPLES).map(([code, item]) => (
              <option key={code} value={code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="stage" aria-label={`${sample.label} font morph`}>
        <div className="endpoint-row">
          <span
            ref={sourceRef}
            className="endpoint source-endpoint"
            data-demo-endpoint="source"
            lang={locale}
          >
            {sample.text}
          </span>

          <span
            ref={targetRef}
            className="endpoint target-endpoint"
            data-demo-endpoint="target"
            lang={locale}
          >
            {sample.text}
          </span>
        </div>
        <div className="endpoint-caption source-caption">{sample.sourceLabel}</div>
        <div className="endpoint-caption target-caption">{sample.targetLabel}</div>
      </section>

      <div className="progress-control">
        <div className="progress-label">
          <label htmlFor="progress">Progress</label>
          <output htmlFor="progress">{Math.round(progress * 100)}%</output>
        </div>
        <input
          id="progress"
          type="range"
          min="0"
          max="1000"
          step="1"
          value={Math.round(progress * 1000)}
          disabled={status !== 'ready'}
          onChange={(event) => updateProgress(Number(event.target.value) / 1000)}
        />
      </div>

      <p className="status" role="status" aria-live="polite">
        {status === 'loading' && 'Preparing glyph correspondence…'}
        {status === 'error' && error}
      </p>
    </main>
  )
}

export function App() {
  return new URLSearchParams(window.location.search).get('renderer') === 'sdf'
    ? <SdfApp />
    : <KuteApp />
}
