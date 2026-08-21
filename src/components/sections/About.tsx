import { t } from 'gt-react'
import { profile, timeline } from '../../data/site'
import { SectionHeading } from '../SectionHeading'

export function About() {
  return (
    <section id="about" className="section">
      <SectionHeading id="about" title={t('About')} />
      {profile.about.map((paragraph) => (
        <p key={paragraph.slice(0, 24)} className="body-text">
          {paragraph}
        </p>
      ))}
      <div className="timeline">
        {timeline.map(({ when, what }) => (
          <div key={what} className="timeline-row">
            <span className="when">{when}</span>
            <span>{what}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
