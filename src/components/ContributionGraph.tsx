import { T, Var, t } from 'gt-react'
import { useEffect, useRef, useState } from 'react'
import { profile } from '../data/site'

interface ContributionDay {
  date: string
  count: number
  level: number
}

interface ContributionsResponse {
  total: { lastYear: number }
  contributions: ContributionDay[]
}

// GitHub's own calendar endpoint is CORS-blocked in browsers; this public
// mirror (the one react-github-calendar uses) serves the same data as JSON.
const API_URL = `https://github-contributions-api.jogruber.de/v4/${profile.githubUser}?y=last`

const DAYS_PER_WEEK = 7
// prettier-ignore
const MONTH_LABELS = [t('Jan'), t('Feb'), t('Mar'), t('Apr'), t('May'), t('Jun'), t('Jul'), t('Aug'), t('Sep'), t('Oct'), t('Nov'), t('Dec')]
const WEEK_PITCH_PX = 12 // 9px cell + 3px gap; mirrors .cg-cell/.cg-grid in global.css
const MIN_LABEL_GAP_WEEKS = 3

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
function toMonthLabels(weeks: (ContributionDay | null)[][]): { week: number; name: string }[] {
  const labels: { week: number; name: string }[] = []
  let prevMonth = -1
  weeks.forEach((week, w) => {
    const first = week.find((day) => day !== null)
    if (!first) return
    const month = new Date(`${first.date}T00:00:00Z`).getUTCMonth()
    if (month !== prevMonth) {
      labels.push({ week: w, name: MONTH_LABELS[month] })
      prevMonth = month
    }
  })
  // Drop a label that would crowd the next one (partial month at the left edge).
  return labels.filter(
    (label, i) => i === labels.length - 1 || labels[i + 1].week - label.week >= MIN_LABEL_GAP_WEEKS,
  )
}

/**
 * GitHub contribution calendar, restyled with the site's accent scale.
 * Purely decorative: renders nothing if the fetch fails.
 */
export function ContributionGraph() {
  const [data, setData] = useState<ContributionsResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(API_URL, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: ContributionsResponse) => setData(json))
      .catch((err: unknown) => {
        // An unmount abort isn't a failure (StrictMode remounts in dev).
        if (!(err instanceof DOMException && err.name === 'AbortError')) setFailed(true)
      })
    return () => controller.abort()
  }, [])

  // When the grid overflows (mobile), start scrolled to the recent end.
  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [data])

  if (failed) return null

  const weeks = data ? toWeeks(data.contributions) : []

  return (
    <section className="section cg" aria-label={t('GitHub contribution calendar')}>
      <div className="cg-scroller" ref={scrollerRef}>
        <div className="cg-inner">
          <div className="cg-months" aria-hidden="true">
            {toMonthLabels(weeks).map(({ week, name }) => (
              <span key={week} style={{ left: week * WEEK_PITCH_PX }}>
                {name}
              </span>
            ))}
          </div>
          <div className="cg-grid">
            {weeks.map((week, w) => (
              <div key={w} className="cg-week">
                {week.map((day, d) =>
                  day ? (
                    <span
                      key={day.date}
                      className={`cg-cell cg-l${Math.min(day.level, 4)}`}
                      title={`${day.count} ${day.count === 1 ? t('contribution') : t('contributions')} · ${day.date}`}
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
      {data && (
        <div className="cg-meta">
          {/* Halves are nowrap, so a line break can only happen between them */}
          <a href={`https://github.com/${profile.githubUser}`} target="_blank" rel="noreferrer">
            <T>
              <span>
                <Var>{data.total.lastYear}</Var> Github contributions
              </span>{' '}
              <span>in the last year</span>
            </T>
          </a>
          <span className="cg-legend" aria-hidden="true">
            {t('less')}
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className={`cg-cell cg-l${level}`} />
            ))}
            {t('more')}
          </span>
        </div>
      )}
    </section>
  )
}
