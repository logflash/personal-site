import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { T, Var, msg } from 'gt-react'
import { profile } from '../data/site'
import type { ContributionDay, ContributionsResponse } from '../lib/contributions'
import { IcuTranslation, StructuredTranslation, useTranslate } from '../lib/i18n'

const DAYS_PER_WEEK = 7
const WEEK_PITCH_PX = 12 // 9px cell + 3px gap; mirrors .cg-cell/.cg-grid in global.css
const MIN_LABEL_GAP_WEEKS = 3
const DEFAULT_SUMMARY_RESTORE_MS = 1000
const CONTRIBUTION_SUMMARY_HASH = '4a68cb0d1371a99a'
const DAILY_CONTRIBUTION_SUMMARY =
  '{count, plural, one {# contribution} other {# contributions}} · {date, date, ::MMMMd}'

function contributionDateFor(target: EventTarget | null): string | undefined {
  const cell = (target as Element | null)?.closest<HTMLElement>('.cg-cell:not(.cg-pad)')
  return cell?.dataset.contributionDate
}

// Scan-only source for `gt translate`. This export is never imported, so the
// function and gt-react bindings are tree-shaken from the browser bundle.
export function ContributionSummaryTranslationSource() {
  return (
    <T>
      <span>
        <Var>{0}</Var> Github contributions
      </span>{' '}
      <span>in the last year</span>
    </T>
  )
}

// Scan-only source for `gt translate`; the unused export is removed from the bundle.
export const DailyContributionSummaryTranslationSource = msg(
  '{count, plural, one {# contribution} other {# contributions}} · {date, date, ::MMMMd}',
)

function contributionDateValue(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

/** Column-major weeks, padded so each column starts on Sunday. */
function toWeeks(days: ContributionDay[]): (ContributionDay | null)[][] {
  const cells: (ContributionDay | null)[] = []
  if (days.length > 0) {
    const firstWeekday = new Date(`${days[0].date}T00:00:00Z`).getUTCDay()
    for (let i = 0; i < firstWeekday; i++) cells.push(null)
  }
  cells.push(...days)
  const weeks: (ContributionDay | null)[][] = []
  for (let i = 0; i < cells.length; i += DAYS_PER_WEEK) {
    weeks.push(cells.slice(i, i + DAYS_PER_WEEK))
  }
  return weeks
}

/** GitHub-style month labels: one at each column where a new month starts. */
function toMonthLabels(
  weeks: (ContributionDay | null)[][],
  monthLabels: string[],
): { week: number; name: string }[] {
  const labels: { week: number; name: string }[] = []
  let prevMonth = -1
  weeks.forEach((week, w) => {
    const first = week.find((day) => day !== null)
    if (!first) return
    const month = new Date(`${first.date}T00:00:00Z`).getUTCMonth()
    if (month !== prevMonth) {
      labels.push({ week: w, name: monthLabels[month] })
      prevMonth = month
    }
  })
  // Drop a label that would crowd the next one (partial month at the left edge).
  return labels.filter(
    (label, i) => i === labels.length - 1 || labels[i + 1].week - label.week >= MIN_LABEL_GAP_WEEKS,
  )
}

interface ContributionGraphProps {
  /** Fetched in the route loader (SSR) — null when the API was unreachable. */
  data: ContributionsResponse | null
}

/**
 * GitHub contribution calendar, restyled with the site's accent scale.
 * Purely decorative: renders nothing without data. Memoized — the page
 * re-renders on every scroll-spy change, and this subtree is by far its
 * largest (~400 nodes).
 */
export const ContributionGraph = memo(function ContributionGraph({ data }: ContributionGraphProps) {
  const gt = useTranslate()
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [tappedDate, setTappedDate] = useState<string | null>(null)
  const [showDefaultSummary, setShowDefaultSummary] = useState(true)
  const defaultRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGraphPointerType = useRef<string | null>(null)
  // Spelled out per month — gt() requires string literals for CLI extraction.
  const monthLabels = [
    gt('Jan'),
    gt('Feb'),
    gt('Mar'),
    gt('Apr'),
    gt('May'),
    gt('Jun'),
    gt('Jul'),
    gt('Aug'),
    gt('Sep'),
    gt('Oct'),
    gt('Nov'),
    gt('Dec'),
  ]
  const weeks = useMemo(() => (data ? toWeeks(data.contributions) : []), [data])
  const activeDate = hoveredDate ?? tappedDate
  const activeDay = useMemo(
    () => data?.contributions.find((day) => day.date === activeDate),
    [activeDate, data],
  )

  const cancelDefaultRestore = () => {
    if (defaultRestoreTimer.current === null) return
    clearTimeout(defaultRestoreTimer.current)
    defaultRestoreTimer.current = null
  }

  const restoreDefaultAfterDelay = () => {
    cancelDefaultRestore()
    setShowDefaultSummary(false)
    defaultRestoreTimer.current = setTimeout(() => {
      defaultRestoreTimer.current = null
      setShowDefaultSummary(true)
    }, DEFAULT_SUMMARY_RESTORE_MS)
  }

  useEffect(
    () => () => {
      if (defaultRestoreTimer.current !== null) clearTimeout(defaultRestoreTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!tappedDate) return

    const releaseTappedCell = (event: MouseEvent) => {
      if (contributionDateFor(event.target) !== tappedDate) setTappedDate(null)
    }
    document.addEventListener('click', releaseTappedCell, true)
    return () => document.removeEventListener('click', releaseTappedCell, true)
  }, [tappedDate])

  if (!data) return null

  return (
    <section className="section cg" aria-label={gt('GitHub contribution calendar')}>
      <div className="cg-scroller">
        <div className="cg-inner">
          <div className="cg-months" aria-hidden="true">
            {toMonthLabels(weeks, monthLabels).map(({ week, name }) => (
              <span key={week} style={{ left: week * WEEK_PITCH_PX }}>
                {name}
              </span>
            ))}
          </div>
          <div
            className="cg-grid"
            onPointerMove={(event) => {
              if (event.pointerType !== 'mouse') return
              cancelDefaultRestore()
              setShowDefaultSummary(false)
              setHoveredDate(contributionDateFor(event.target) ?? null)
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'mouse') return
              setHoveredDate(null)
              restoreDefaultAfterDelay()
            }}
            onPointerDown={(event) => {
              lastGraphPointerType.current = event.pointerType
            }}
            onClick={(event) => {
              const pointerType =
                (event.nativeEvent as PointerEvent).pointerType || lastGraphPointerType.current
              lastGraphPointerType.current = null
              if (!pointerType || pointerType === 'mouse') return
              const date = contributionDateFor(event.target)
              if (date) setTappedDate((current) => (current === date ? null : date))
            }}
            onPointerCancel={() => {
              lastGraphPointerType.current = null
            }}
          >
            {weeks.map((week, w) => (
              <div key={w} className="cg-week">
                {week.map((day, d) =>
                  day ? (
                    <span
                      key={day.date}
                      className={`cg-cell cg-l${Math.min(day.level, 4)}${tappedDate === day.date ? ' cg-touch-active' : ''}`}
                      data-contribution-date={day.date}
                      title={`${day.count} ${day.count === 1 ? gt('contribution') : gt('contributions')} · ${day.date}`}
                    />
                  ) : (
                    <span key={`pad-${d}`} className="cg-cell cg-pad" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cg-meta">
        {/* Halves are nowrap, so a line break can only happen between them */}
        <a href={`https://github.com/${profile.githubUser}`} target="_blank" rel="noreferrer">
          {activeDay ? (
            <IcuTranslation
              source={DAILY_CONTRIBUTION_SUMMARY}
              variables={{ count: activeDay.count, date: contributionDateValue(activeDay.date) }}
            />
          ) : showDefaultSummary ? (
            <StructuredTranslation
              hash={CONTRIBUTION_SUMMARY_HASH}
              variables={{ _gt_value_2: data.total.lastYear }}
            >
              <span>{data.total.lastYear} Github contributions</span> <span>in the last year</span>
            </StructuredTranslation>
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </a>
        <span className="cg-legend" aria-hidden="true">
          {gt('less')}
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`cg-cell cg-l${level}`} />
          ))}
          {gt('more')}
        </span>
      </div>
    </section>
  )
})
