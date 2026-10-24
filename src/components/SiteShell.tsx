import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useRecordingRuntime } from '../hooks/useRecordingRuntime'
import { useTheme } from '../hooks/useTheme'
import { MobileTopBar } from './MobileTopBar'
import { Sidebar } from './Sidebar'
import { profile } from '../data/site'
import { SitePageContext } from './SitePageContext'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'
import { READING_LAYOUT_READY_EVENT } from '../lib/pageMemory'

export function SiteShell({
  children,
  mainClassName,
  page = 'home',
}: {
  children: ReactNode
  mainClassName?: string
  page?: string
}) {
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    // The document shell may hydrate before its route. Signal only after the
    // route's children have restored their disclosures/filter state; a frame
    // later, their layout-effect state updates have committed too.
    if (mainRef.current) mainRef.current.dataset.readingReady = ''
    document.dispatchEvent(new Event(READING_LAYOUT_READY_EVENT))
  }, [])
  const gt = useTranslate()
  const { toggleTheme } = useTheme()
  const { status: recordingStatus } = useRecordingRuntime()
  const suppressLocaleInteraction =
    recordingStatus === 'preparing' || recordingStatus === 'recording'

  return (
    <SitePageContext.Provider value={page}>
      <div className="layout">
        <Link
          className="skip-link"
          data-_gt-hash={translationHash('Skip to content')}
          to="."
          hash="main-content"
          activeOptions={{ includeHash: true }}
          onClick={() => document.getElementById('main-content')?.focus({ preventScroll: true })}
        >
          {gt('Skip to content')}
        </Link>
        <Sidebar
          onToggleTheme={toggleTheme}
          suppressLocaleInteraction={suppressLocaleInteraction}
        />
        <div className="content">
          <MobileTopBar
            onToggleTheme={toggleTheme}
            suppressLocaleInteraction={suppressLocaleInteraction}
          />
          <main ref={mainRef} id="main-content" tabIndex={-1} className={mainClassName}>
            {children}
            <footer className="copyright-mobile">
              © {profile.copyrightYear} {profile.name}
            </footer>
          </main>
        </div>
      </div>
    </SitePageContext.Provider>
  )
}
