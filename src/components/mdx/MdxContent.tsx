import { Link, getRouteApi } from '@tanstack/react-router'
import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { externalProps } from '../../lib/links'
import { useFontMorphNavigation } from '../../hooks/useFontMorphNavigation'
import { resumeHeaderTransition } from '../../lib/headerTransitions'
import { useMdxGT } from '../../lib/mdxTranslation'
import { emitSkillCardAnimation, SKILL_CARD_ANIMATION_MS } from '../../lib/skillCardAnimation'
import { translationHash } from '../../lib/translationHash'
import { SectionHeading } from '../SectionHeading'
import { TransitionPageHeading, UndoIcon } from '../TransitionPageHeading'

interface SectionContextValue {
  id: string
  tight: boolean
}

const SectionContext = createContext<SectionContextValue | null>(null)
const rootRoute = getRouteApi('__root__')
const RESUME_SKILL_MIGRATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

function text(children: ReactNode, component: string): string {
  if (typeof children === 'string') return children.trim()
  if (Array.isArray(children) && children.every((child) => typeof child === 'string')) {
    return children.join('').trim()
  }
  throw new Error(`${component} only accepts plain text so translation node boundaries stay stable`)
}

function elements(children: ReactNode) {
  return Children.toArray(children).filter(isValidElement)
}

const TRANSLATABLE_INLINE_ELEMENTS = new Set([
  'a',
  'abbr',
  'b',
  'code',
  'em',
  'i',
  'small',
  'span',
  'strong',
])

function translatedInline(children: ReactNode, gt: (source: string) => string): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = child.match(/^(\s*)([\s\S]*?\S)(\s*)$/)
      if (!parts) return child
      const [, leading, source, trailing] = parts
      return (
        <Fragment>
          {leading}
          <span data-_gt-hash={translationHash(source)} style={{ display: 'contents' }}>
            {gt(source)}
          </span>
          {trailing}
        </Fragment>
      )
    }

    if (
      isValidElement(child) &&
      typeof child.type === 'string' &&
      TRANSLATABLE_INLINE_ELEMENTS.has(child.type)
    ) {
      const element = child as ReactElement<{ children?: ReactNode }>
      return cloneElement(element, undefined, translatedInline(element.props.children, gt))
    }

    return child
  })
}

export function MdxSection({
  id,
  tight = false,
  className,
  children,
}: {
  id: string
  tight?: boolean
  className?: string
  children: ReactNode
}) {
  const value = { id, tight }
  return (
    <SectionContext.Provider value={value}>
      <section id={id} className={className ? `section ${className}` : 'section'}>
        {children}
      </section>
    </SectionContext.Provider>
  )
}

export function MdxHeading({ children }: ComponentPropsWithoutRef<'h2'>) {
  const section = useContext(SectionContext)
  const gt = useMdxGT()
  if (!section) throw new Error('MDX headings must be inside MdxSection')
  const source = text(children, 'MDX headings')

  return (
    <SectionHeading
      id={section.id}
      title={gt(source)}
      tight={section.tight}
      translationHash={translationHash(source)}
    />
  )
}

export function MdxParagraph({ children }: ComponentPropsWithoutRef<'p'>) {
  const section = useContext(SectionContext)
  const gt = useMdxGT()
  if (!section) throw new Error('MDX paragraphs must be inside MdxSection')
  const source = text(children, 'MDX paragraphs')

  return (
    <p
      className={section.id === 'home' ? 'intro' : 'body-text'}
      data-_gt-hash={translationHash(source)}
    >
      {gt(source)}
    </p>
  )
}

export function ResumeHeading({ children }: ComponentPropsWithoutRef<'h1'>) {
  const gt = useMdxGT()
  const { locale } = rootRoute.useLoaderData()
  const source = text(children, 'Resume heading')

  return (
    <TransitionPageHeading
      transition={resumeHeaderTransition}
      title={gt(source)}
      translationHash={translationHash(source)}
      renderAction={(handlers) => (
        <Link
          className="heading-control transition-page-heading-action-control"
          to="/$locale"
          params={{ locale }}
          title={gt('Home')}
          aria-label={gt('Home')}
          {...handlers}
        >
          <UndoIcon />
        </Link>
      )}
    />
  )
}

export function ResumeCopy({ children }: { children: ReactNode }) {
  return <div className="resume-copy">{children}</div>
}

export function ResumeSectionHeading({ children }: ComponentPropsWithoutRef<'h2'>) {
  const section = useContext(SectionContext)
  const gt = useMdxGT()
  if (!section) throw new Error('Resume headings must be inside MdxSection')
  const source = text(children, 'Resume headings')

  return (
    <SectionHeading
      id={section.id}
      title={gt(source)}
      tight={section.tight}
      translationHash={translationHash(source)}
    />
  )
}

export function ResumeParagraph({ children }: ComponentPropsWithoutRef<'p'>) {
  const gt = useMdxGT()
  return <p className="resume-copy-paragraph">{translatedInline(children, gt)}</p>
}

export function ResumeListItem({ children }: ComponentPropsWithoutRef<'li'>) {
  const gt = useMdxGT()
  return <li>{translatedInline(children, gt)}</li>
}

export function QuickLinks({ children }: { children: ReactNode }) {
  return (
    <div className="quick-links">
      {elements(children).map((child, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className="sep" aria-hidden="true">
              ·
            </span>
          )}
          {child}
        </Fragment>
      ))}
    </div>
  )
}

export function QuickLink({
  label,
  translatedLabel,
  href,
  resume,
  external,
}: {
  label?: string
  translatedLabel?: string
  href?: string
  resume?: boolean
  external?: boolean
}) {
  const gt = useMdxGT()
  const { locale } = rootRoute.useLoaderData()
  const resumeMorphHandlers = useFontMorphNavigation(resumeHeaderTransition.key)
  const source = translatedLabel ?? label ?? ''
  const translatedContent = translatedLabel ? gt(translatedLabel) : source
  const translationProps = translatedLabel ? { 'data-_gt-hash': translationHash(source) } : {}

  if (resume) {
    return (
      <Link
        to="/$locale/resume"
        params={{ locale }}
        {...resumeMorphHandlers}
        className="resume-link"
        data-font-morph={resumeHeaderTransition.key}
        {...translationProps}
      >
        {translatedContent}
      </Link>
    )
  }

  return (
    <a href={href} {...externalProps(external)} {...translationProps}>
      {translatedContent}
    </a>
  )
}

export function Timeline({ children }: { children: ReactNode }) {
  return <div className="timeline">{elements(children)}</div>
}

export function TimelineEntry({
  when,
  translatedWhen,
  description,
}: {
  when?: string
  translatedWhen?: string
  description: string
}) {
  const gt = useMdxGT()
  const whenSource = translatedWhen ?? when ?? ''
  return (
    <div className="timeline-row">
      <span
        className="when"
        {...(translatedWhen ? { 'data-_gt-hash': translationHash(whenSource) } : {})}
      >
        {translatedWhen ? gt(translatedWhen) : whenSource}
      </span>
      <span data-_gt-hash={translationHash(description)}>{gt(description)}</span>
    </div>
  )
}

function PaperIcon() {
  return (
    <svg
      className="doc-icon"
      width="17"
      height="21"
      viewBox="0 0 17 21"
      fill="none"
      aria-hidden="true"
    >
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

export function Stack({ children }: { children: ReactNode }) {
  return <div className="stack">{elements(children)}</div>
}

export function Paper({
  name,
  venue,
  description,
  url,
}: {
  name: string
  venue: string
  description: string
  url: string
}) {
  const gt = useMdxGT()
  return (
    <a className="row-link pub" href={url} target="_blank" rel="noreferrer">
      <PaperIcon />
      <span className="pub-body">
        <span className="title-row">
          <span className="item-name">{name}</span>
          <span className="pdf-chip">PDF</span>
          <span className="venue">{venue}</span>
        </span>
        <span className="item-desc" data-_gt-hash={translationHash(description)}>
          {gt(description)}
        </span>
        <span className="venue venue-sm">{venue}</span>
      </span>
    </a>
  )
}

const LANGUAGE_COLORS: Record<string, string> = {
  Python: '#3572A5',
  C: '#555555',
  'C++': '#f34b7d',
  Bash: '#89e051',
  Assembly: '#6E4C13',
  Verilog: '#b2b7f8',
  Rust: '#dea584',
  SQL: '#e38c00',
  CUDA: '#3A4E3A',
  Go: '#00ADD8',
  Java: '#b07219',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Dart: '#00B4AB',
  CSS: '#563d7c',
  HTML: '#e34c26',
  Svelte: '#ff3e00',
  Jupyter: '#DA5B0B',
}

function resumeSkillColor(label: string, language: boolean) {
  return language ? (LANGUAGE_COLORS[label] ?? 'var(--acc)') : 'var(--mut)'
}

export function ResumeEntry({
  logo,
  title,
  date,
  fact,
  gpa,
  languages,
  children,
}: {
  logo: string
  title: string
  date: string
  fact: string
  gpa?: string
  languages?: string
  children: ReactNode
}) {
  const gt = useMdxGT()
  const languageChips = languages?.split(' · ').map((language) => ({
    language,
    color: LANGUAGE_COLORS[language] ?? 'var(--mut)',
  }))

  return (
    <details className="resume-entry">
      <summary className="resume-entry-toggle">
        <span className="resume-entry-logo" aria-hidden="true">
          <img src={logo} alt="" width="48" height="48" loading="lazy" decoding="async" />
        </span>
        <span className="resume-entry-overview">
          <span className={`resume-entry-facts${gpa ? ' resume-entry-facts-with-gpa' : ''}`}>
            <strong className="resume-entry-title" data-_gt-hash={translationHash(title)}>
              {gt(title)}
            </strong>
            <em className="resume-entry-date" data-_gt-hash={translationHash(date)}>
              {gt(date)}
            </em>
            <span className="resume-entry-fact" data-_gt-hash={translationHash(fact)}>
              {gt(fact)}
            </span>
            {gpa ? (
              <em className="resume-entry-gpa" data-_gt-hash={translationHash(gpa)}>
                {gt(gpa)}
              </em>
            ) : null}
          </span>
          {languageChips ? (
            <span className="chips resume-entry-languages">
              {languageChips.map(({ language, color }) => (
                <span key={language} className="chip">
                  <span className="lang-dot" style={{ background: color }} aria-hidden="true" />
                  {language}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="resume-entry-details">{children}</div>
    </details>
  )
}

interface ResumeSkillProps {
  label: string
  language?: boolean
}

export function ResumeSkill({ label, language = false }: ResumeSkillProps) {
  const gt = useMdxGT()
  const color = resumeSkillColor(label, language)
  return (
    <li className="resume-skill-item">
      <span className="lang-dot" style={{ background: color }} aria-hidden="true" />
      <span {...(language ? {} : { 'data-_gt-hash': translationHash(label) })}>
        {language ? label : gt(label)}
      </span>
    </li>
  )
}

interface SkillDotMigration {
  animations: Animation[]
  layer: HTMLDivElement
}

function createSkillDotMigration(
  sourceDots: HTMLElement[],
  destinationDots: HTMLElement[],
): SkillDotMigration {
  const layer = document.createElement('div')
  // The animation is purely presentational. Keeping its transient fixed-position
  // clones out of rrweb snapshots avoids recording locale-specific coordinates.
  layer.className = 'rr-block resume-skill-migration-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)

  const animations: Animation[] = []
  sourceDots.forEach((sourceDot, index) => {
    const destinationDot = destinationDots[index]
    if (!destinationDot) return

    const source = sourceDot.getBoundingClientRect()
    const destination = destinationDot.getBoundingClientRect()
    const clone = document.createElement('span')
    clone.className = 'resume-skill-migrating-dot'
    const color = getComputedStyle(sourceDot).backgroundColor
    clone.style.setProperty('--resume-skill-dot-color', color)
    Object.assign(clone.style, {
      left: `${source.left}px`,
      top: `${source.top}px`,
      width: `${source.width}px`,
      height: `${source.height}px`,
    })
    layer.append(clone)

    animations.push(
      clone.animate(
        [
          { transform: 'translate3d(0, 0, 0) scale(1)' },
          {
            transform: `translate3d(${destination.left - source.left}px, ${destination.top - source.top}px, 0) scale(${destination.width / source.width}, ${destination.height / source.height})`,
          },
        ],
        {
          duration: SKILL_CARD_ANIMATION_MS,
          easing: RESUME_SKILL_MIGRATION_EASING,
          fill: 'forwards',
        },
      ),
    )
  })

  // Hide only the two real sets of dots while their fixed-position copies move.
  // Web Animations are not DOM mutations, so rrweb receives the semantic open
  // state without an incomplete animation scaffold.
  new Set([...sourceDots, ...destinationDots]).forEach((dot) => {
    animations.push(
      dot.animate([{ opacity: 0 }, { opacity: 0 }], {
        duration: SKILL_CARD_ANIMATION_MS,
        fill: 'both',
      }),
    )
  })

  return { animations, layer }
}

export function ResumeSkillCard({ title, children }: { title: string; children: ReactNode }) {
  const gt = useMdxGT()
  const contentId = useId()
  const summaryDotsRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const transitioningRef = useRef(false)
  const [open, setOpen] = useState(false)
  const skills = elements(children) as ReactElement<ResumeSkillProps>[]
  const titleHash = translationHash(title)

  useEffect(
    () => () => {
      cleanupRef.current?.()
    },
    [],
  )

  const toggle = () => {
    const content = contentRef.current
    const summaryDots = summaryDotsRef.current
    if (!content || !summaryDots || transitioningRef.current) return

    const nextOpen = !open
    const sourceHeight = content.getBoundingClientRect().height
    // The hidden content retains its final width, so scrollHeight includes
    // every locale-specific line wrap. Read it exactly once before migration.
    const destinationHeight = nextOpen ? content.scrollHeight : 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const canMigrate = !reducedMotion && typeof content.animate === 'function'

    if (!canMigrate) {
      flushSync(() => setOpen(nextOpen))
      return
    }

    const compactDots = Array.from(summaryDots.querySelectorAll<HTMLElement>('.lang-dot'))
    const expandedDots = Array.from(content.querySelectorAll<HTMLElement>('.lang-dot'))
    const sourceDots = nextOpen ? compactDots : expandedDots
    const destinationDots = nextOpen ? expandedDots : compactDots
    emitSkillCardAnimation(titleHash, nextOpen)
    const migration = createSkillDotMigration(sourceDots, destinationDots)

    transitioningRef.current = true
    flushSync(() => setOpen(nextOpen))
    const heightAnimation = content.animate(
      [
        { height: `${sourceHeight}px`, visibility: 'visible' },
        { height: `${destinationHeight}px`, visibility: 'visible' },
      ],
      {
        duration: SKILL_CARD_ANIMATION_MS,
        easing: RESUME_SKILL_MIGRATION_EASING,
      },
    )
    const animations = [...migration.animations, heightAnimation]
    const cleanup = () => {
      animations.forEach((animation) => animation.cancel())
      migration.layer.remove()
      if (cleanupRef.current === cleanup) cleanupRef.current = null
      transitioningRef.current = false
    }
    cleanupRef.current = cleanup

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(cleanup)
  }

  return (
    <section
      className="resume-skill-card"
      data-gt-skill-card={titleHash}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="resume-skill-card-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
      >
        <strong className="resume-skill-card-title" data-_gt-hash={titleHash}>
          {gt(title)}
        </strong>
        <span ref={summaryDotsRef} className="resume-skill-card-dots" aria-hidden="true">
          {skills.map(({ props }, index) => (
            <span
              key={`${props.label}-${index}`}
              className="lang-dot"
              style={{ background: resumeSkillColor(props.label, Boolean(props.language)) }}
            />
          ))}
        </span>
      </button>
      <div
        ref={contentRef}
        id={contentId}
        className="resume-skill-card-content"
        aria-hidden={!open}
        inert={open ? undefined : true}
      >
        <div className="resume-skill-card-details">
          <ul className="resume-skill-list">{skills}</ul>
        </div>
      </div>
    </section>
  )
}

export function Project({
  translatedName,
  description,
  url,
  languages,
  color,
}: {
  translatedName: string
  description: string
  url: string
  languages: string
  color: string
}) {
  const gt = useMdxGT()
  const repoPath = url.replace('https://', '')
  const languageChips = languages.split(' · ').map((language) => ({
    language,
    color: LANGUAGE_COLORS[language] ?? color,
  }))

  return (
    <a className="row-link project" href={url} target="_blank" rel="noreferrer">
      <span className="title-row">
        <span className="item-name" data-_gt-hash={translationHash(translatedName)}>
          {gt(translatedName)}
        </span>
        <span className="repo-path">{repoPath}</span>
      </span>
      <span className="item-desc" data-_gt-hash={translationHash(description)}>
        {gt(description)}
      </span>
      <span className="chips">
        {languageChips.map(({ language, color: chipColor }) => (
          <span key={language} className="chip">
            <span className="lang-dot" style={{ background: chipColor }} />
            {language}
          </span>
        ))}
      </span>
    </a>
  )
}

export function ContactRows({ children }: { children: ReactNode }) {
  return <div className="contact-rows">{elements(children)}</div>
}

export function ContactRow({
  label,
  translatedLabel,
  value,
  href,
  external,
}: {
  label?: string
  translatedLabel?: string
  value: string
  href?: string
  external?: boolean
}) {
  const gt = useMdxGT()
  const labelSource = translatedLabel ?? label ?? ''
  return (
    <div className="contact-row">
      <span
        className="label"
        {...(translatedLabel ? { 'data-_gt-hash': translationHash(labelSource) } : {})}
      >
        {translatedLabel ? gt(translatedLabel) : labelSource}
      </span>
      {href ? (
        <a href={href} {...externalProps(external)}>
          {value}
        </a>
      ) : (
        <span>{value}</span>
      )}
    </div>
  )
}

export const sharedMdxComponents = {
  h2: MdxHeading,
  p: MdxParagraph,
  MdxSection,
  QuickLinks,
  QuickLink,
  Timeline,
  TimelineEntry,
  Stack,
  Paper,
  Project,
  ContactRows,
  ContactRow,
}

export const resumeMdxComponents = {
  ...sharedMdxComponents,
  h1: ResumeHeading,
  h2: ResumeSectionHeading,
  li: ResumeListItem,
  p: ResumeParagraph,
  ResumeEntry,
  ResumeSkill,
  ResumeSkillCard,
  ResumeCopy,
}
