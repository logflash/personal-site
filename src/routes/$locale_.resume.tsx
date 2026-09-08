import { createFileRoute, redirect } from '@tanstack/react-router'
import { useGT } from 'gt-react'
import { useLayoutEffect } from 'react'
import { SiteShell } from '../components/SiteShell'
import { profile } from '../data/site'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'
import { translationHash } from '../lib/translationHash'

export const Route = createFileRoute('/$locale_/resume')({
  beforeLoad: ({ params }) => {
    if (!SUPPORTED_LOCALES.includes(params.locale)) {
      throw redirect({
        to: '/$locale/resume',
        params: { locale: DEFAULT_LOCALE },
      })
    }
  },
  head: () => ({
    meta: [{ title: `Resume — ${profile.name}` }, { name: 'robots', content: 'noindex' }],
  }),
  component: ResumePage,
})

function ResumePage() {
  const gt = useGT()

  // The pre-paint script handles direct loads. A layout effect keeps the SPA
  // route's sidebar state in the same commit that the morph target is sampled.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.activeSection = 'resume'

    return () => {
      if (root.dataset.activeSection === 'resume') root.dataset.activeSection = 'home'
    }
  }, [])

  return (
    <SiteShell mainClassName="resume-page">
      <h1
        className="resume-title"
        data-font-morph="resume-title"
        data-_gt-hash={translationHash('Resume')}
      >
        {gt('Resume')}
      </h1>
    </SiteShell>
  )
}
