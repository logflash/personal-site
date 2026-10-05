import type { ReactNode } from 'react'
import { useRecordingRuntime } from '../hooks/useRecordingRuntime'
import { useTheme } from '../hooks/useTheme'
import { MobileTopBar } from './MobileTopBar'
import { Sidebar } from './Sidebar'
import { profile } from '../data/site'
import { SitePageContext } from './SitePageContext'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'

export function SiteShell({
  children,
  mainClassName,
  page = 'home',
}: {
  children: ReactNode
  mainClassName?: string
  page?: string
}) {
  const gt = useTranslate()
  const { toggleTheme } = useTheme()
  const { status: recordingStatus } = useRecordingRuntime()
  const suppressLocaleInteraction =
    recordingStatus === 'preparing' || recordingStatus === 'recording'

  return (
    <SitePageContext.Provider value={page}>
      <div className="layout">
        <a
          className="skip-link"
          data-_gt-hash={translationHash('Skip to content')}
          href="#main-content"
          onClick={() => document.getElementById('main-content')?.focus()}
        >
          {gt('Skip to content')}
        </a>
        <Sidebar
          onToggleTheme={toggleTheme}
          suppressLocaleInteraction={suppressLocaleInteraction}
        />
        <div className="content">
          <MobileTopBar
            onToggleTheme={toggleTheme}
            suppressLocaleInteraction={suppressLocaleInteraction}
          />
          <main id="main-content" tabIndex={-1} className={mainClassName}>
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
