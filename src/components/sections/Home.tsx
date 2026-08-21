import { useMessages } from 'gt-react'
import { Fragment, memo } from 'react'
import { profile, quickLinks } from '../../data/site'
import { externalProps } from '../../lib/links'

export const Home = memo(function Home() {
  const m = useMessages()
  return (
    <section id="home" className="section">
      <p className="intro">{m(profile.intro)}</p>
      <div className="quick-links">
        {quickLinks.map((link, i) => (
          <Fragment key={link.href}>
            {i > 0 && (
              <span className="sep" aria-hidden="true">
                ·
              </span>
            )}
            <a href={link.href} {...externalProps(link.external)}>
              {m(link.label)}
            </a>
          </Fragment>
        ))}
      </div>
    </section>
  )
})
