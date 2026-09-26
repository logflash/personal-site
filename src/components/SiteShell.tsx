import type { ReactNode } from 'react'
import { useRecordingRuntime } from '../hooks/useRecordingRuntime'
import { useTheme } from '../hooks/useTheme'
import { MobileTopBar } from './MobileTopBar'
import { Sidebar } from './Sidebar'
import { profile } from '../data/site'
import { SitePageContext } from './SitePageContext'

export function SiteShell({
  children,
  mainClassName,
  page = 'home',
}: {
  children: ReactNode
  mainClassName?: string
  page?: string
}) {
  const { toggleTheme } = useTheme()
  const { status: recordingStatus } = useRecordingRuntime()
  const suppressLocaleInteraction =
    recordingStatus === 'preparing' || recordingStatus === 'recording'

  return (
    <SitePageContext.Provider value={page}>
      <div className="layout">
        <Sidebar
          onToggleTheme={toggleTheme}
          suppressLocaleInteraction={suppressLocaleInteraction}
        />
        <div className="content">
          <MobileTopBar
            onToggleTheme={toggleTheme}
            suppressLocaleInteraction={suppressLocaleInteraction}
          />
          <main className={mainClassName}>
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
