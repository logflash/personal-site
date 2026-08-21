import { useGT, useMessages } from 'gt-react'
import { profile, timeline } from '../../data/site'
import { SectionHeading } from '../SectionHeading'

export function About() {
  const gt = useGT()
  const m = useMessages()
  return (
    <section id="about" className="section">
      <SectionHeading id="about" title={gt('About')} />
      {profile.about.map((paragraph) => (
        <p key={paragraph.slice(0, 24)} className="body-text">
          {m(paragraph)}
        </p>
      ))}
      <div className="timeline">
        {timeline.map(({ when, what }) => (
          <div key={what} className="timeline-row">
            <span className="when">{m(when)}</span>
            <span>{m(what)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
