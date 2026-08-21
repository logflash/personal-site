import { memo } from 'react'
import { useGT, useMessages } from 'gt-react'
import { contactRows } from '../../data/site'
import { externalProps } from '../../lib/links'
import { SectionHeading } from '../SectionHeading'

export const Contact = memo(function Contact() {
  const gt = useGT()
  const m = useMessages()
  return (
    <section id="contact" className="section contact">
      <SectionHeading id="contact" title={gt('Contact')} />
      <div className="contact-rows">
        {contactRows.map((row) => (
          <div key={row.label} className="contact-row">
            <span className="label">{m(row.label)}</span>
            {row.href ? (
              <a href={row.href} {...externalProps(row.external)}>
                {row.text}
              </a>
            ) : (
              <span>{row.text}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
})
