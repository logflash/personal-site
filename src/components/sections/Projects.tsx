import { memo } from 'react'
import { useGT, useMessages } from 'gt-react'
import { repos } from '../../data/site'
import { SectionHeading } from '../SectionHeading'

export const Projects = memo(function Projects() {
  const gt = useGT()
  const m = useMessages()
  return (
    <section id="projects" className="section">
      <SectionHeading id="projects" title={gt('Projects')} tight />
      <div className="stack">
        {repos.map((repo) => (
          <a
            key={repo.name}
            className="row-link project"
            href={repo.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="title-row">
              <span className="item-name">{m(repo.name)}</span>
              <span className="repo-path">{repo.repoPath}</span>
            </span>
            <span className="item-desc">{m(repo.desc)}</span>
            <span className="chips">
              {repo.langChips.map(({ lang, color }) => (
                <span key={lang} className="chip">
                  <span className="lang-dot" style={{ background: color }} />
                  {lang}
                </span>
              ))}
            </span>
          </a>
        ))}
      </div>
    </section>
  )
})
