import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { msg } from 'gt-react'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'

const topics = [
  { id: 'all', label: msg('All projects') },
  { id: 'learning', label: msg('Machine learning') },
  { id: 'robotics', label: msg('Robotics') },
  { id: 'systems', label: msg('Tools & systems') },
] as const
const TopicContext = createContext('all')
type ProjectElement = ReactElement<{ topics: string }>
const matches = (project: ProjectElement, topic: string) =>
  topic === 'all' || project.props.topics.split(' ').includes(topic)

export function ProjectExplorer({ children }: { children: ReactNode }) {
  const gt = useTranslate()
  const [topic, setTopic] = useState('all')
  const groups = Children.toArray(children).filter(isValidElement) as ReactElement<{
    children: ReactNode
  }>[]
  const projects = groups.flatMap(
    (group) => Children.toArray(group.props.children).filter(isValidElement) as ProjectElement[],
  )
  const count = projects.filter((project) => matches(project, topic)).length
  return (
    <TopicContext.Provider value={topic}>
      <div className="project-explorer">
        <div className="project-filters" role="group" aria-label={gt('Filter projects')}>
          {topics.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={topic === id} onClick={() => setTopic(id)}>
              <span data-_gt-hash={translationHash(label)}>{gt(label)}</span>
            </button>
          ))}
        </div>
        <p className="project-count" role="status" aria-live="polite" aria-atomic="true">
          <span data-_gt-hash={translationHash('Projects')}>{gt('Projects')}</span> · {count} /{' '}
          {projects.length}
        </p>
        {children}
      </div>
    </TopicContext.Provider>
  )
}

export function ProjectGroup({ year, children }: { year: string; children: ReactNode }) {
  const topic = useContext(TopicContext)
  const projects = Children.toArray(children).filter(isValidElement) as ProjectElement[]
  // DOM visibility is deliberately explicit: rrweb can reproduce filtering
  // without running React, and hidden groups keep their authored year order.
  return (
    <div className="project-group" hidden={!projects.some((project) => matches(project, topic))}>
      <h3>{year}</h3>
      <div className="stack">
        {projects.map((project, index) => (
          <div key={project.key ?? index} hidden={!matches(project, topic)}>
            {project}
          </div>
        ))}
      </div>
    </div>
  )
}

export const ProjectFilterTranslation = msg('Filter projects')
