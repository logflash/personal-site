import { t } from 'gt-react'
import { papers } from '../../data/site'
import { SectionHeading } from '../SectionHeading'

function PaperIcon() {
  return (
    <svg className="doc-icon" width="17" height="21" viewBox="0 0 17 21" fill="none" aria-hidden="true">
      <path
        d="M1 1.5h9.5L16 6.8v12.7a.5.5 0 0 1-.5.5h-14a.5.5 0 0 1-.5-.5v-18Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M10.3 1.6v5.3H15.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path
        className="doc-lines"
        d="M4.2 11.6h8.6M4.2 14.4h8.6M4.2 17.2h5.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Research() {
  return (
    <section id="research" className="section">
      <SectionHeading id="research" title={t('Research')} tight />
      <div className="stack">
        {papers.map((paper) => (
          <a key={paper.name} className="row-link pub" href={paper.url} target="_blank" rel="noreferrer">
            <PaperIcon />
            <span className="pub-body">
              <span className="title-row">
                <span className="item-name">{paper.name}</span>
                <span className="pdf-chip">PDF</span>
                <span className="venue">{paper.venue}</span>
              </span>
              <span className="item-desc">{paper.desc}</span>
              {/* Mobile layout shows the venue below the description instead */}
              <span className="venue venue-sm">{paper.venue}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}
