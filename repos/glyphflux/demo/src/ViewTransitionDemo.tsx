import { Link } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { beginFontMorph, prepareFontMorph } from '../../src'
import { configureDemoGlyphflux } from './configureGlyphflux'
import { languageFor, profileFor, profileStyle } from './catalog'
import { DemoHeader } from './DemoHeader'
import { useInkCentering } from './useInkCentering'

const transitionKey = 'glyphflux-route-heading'

interface ViewTransitionDemoProps {
  locale: string
  fontRole: 'sans' | 'serif'
  onNavigate: (fontRole: 'sans' | 'serif') => void
  onLocaleChange: (locale: string) => void
}

export function ViewTransitionDemo({
  locale,
  fontRole,
  onNavigate,
  onLocaleChange,
}: ViewTransitionDemoProps) {
  const language = languageFor(locale)
  const profile = profileFor(language)
  const [moving, setMoving] = useState(false)
  const headingPositionRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const nextRole = fontRole === 'sans' ? 'serif' : 'sans'

  useInkCentering(
    headingRef,
    headingPositionRef,
    headingRef,
    `${language.code}:${fontRole}`,
  )

  useLayoutEffect(() => {
    configureDemoGlyphflux()
    const root = document.documentElement
    root.style.setProperty('--font-morph-sans-weight', String(profile.sourceAxes?.wght ?? 400))
    root.style.setProperty('--font-morph-serif-weight', String(profile.targetAxes?.wght ?? 600))
    root.style.setProperty('--font-morph-serif-optical-size', String(profile.targetAxes?.opsz ?? 0))
  }, [profile])

  useEffect(() => {
    setMoving(false)
    void prepareFontMorph(transitionKey)
  }, [fontRole, locale])

  const navigate = async () => {
    if (moving) return
    setMoving(true)
    await prepareFontMorph(transitionKey)
    beginFontMorph(transitionKey)
    onNavigate(nextRole)
  }

  return (
    <main
      className={`view-demo ${fontRole}`}
      data-view-demo={fontRole}
      data-font-profile={language.profile}
      style={profileStyle(language)}
    >
      <DemoHeader
        locale={language.code}
        title="View transition"
        selectId="view-locale"
        onLocaleChange={onLocaleChange}
      />
      <section className="view-demo-scene">
        <div ref={headingPositionRef} className={`view-heading-position ${fontRole}`}>
          <h1
            key={fontRole}
            ref={headingRef}
            className={`view-heading ${fontRole}`}
            data-font-morph={transitionKey}
            lang={language.language ?? language.code}
            dir={language.direction}
          >
            {language.text}
          </h1>
        </div>
        <div className="view-demo-copy" key={fontRole}>
          <h2>{fontRole === 'sans' ? 'One string, ready to move.' : 'The content changed too.'}</h2>
          <p>
            {fontRole === 'sans'
              ? 'Glyph correspondence is precomputed at build time, then served as compact data that browsers reconstruct with little runtime overhead.'
              : 'Position, scale, color, and glyph structure settle together while the surrounding route updates.'}
          </p>
        </div>
        <div className="view-demo-action">
          <button type="button" disabled={moving} onClick={() => void navigate()}>
            Morph to {nextRole === 'serif' ? profile.targetLabel : profile.sourceLabel}
          </button>
        </div>
      </section>
      <Link
        className="demo-switch-link"
        to="/$language"
        params={{ language: language.code }}
      >
        See the controlled transition demo
      </Link>
    </main>
  )
}
