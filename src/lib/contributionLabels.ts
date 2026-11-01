export const DAILY_CONTRIBUTION_SUMMARY =
  '{count, plural, one {# contribution} other {# contributions}} · {date, date, ::MMMMd}'

// Calendar dates have no time zone. Construct local midnight so ICU displays
// the same calendar day on the server and when formatting an active tooltip.
export function contributionDateValue(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}
