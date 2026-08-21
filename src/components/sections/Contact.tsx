import { t } from 'gt-react'
import { contactRows } from '../../data/site'
import { externalProps } from '../../lib/links'
import { SectionHeading } from '../SectionHeading'

export function Contact() {
  return (
    <section id="contact" className="section contact">
      <SectionHeading id="contact" title={t('Contact')} />
      <div className="contact-rows">
        {contactRows.map((row) => (
          <div key={row.label} className="contact-row">
            <span className="label">{row.label}</span>
            <a href={row.href} {...externalProps(row.external)}>
              {row.text}
            </a>
          </div>
        ))}
      </div>
    </section>
  )
}
