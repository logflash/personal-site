import { msg } from 'gt-react'
import { useTranslate } from '../lib/i18n'
import { translationHash } from '../lib/translationHash'

export const disclosureMessages = [msg('Hide details')]

export function DisclosureLabel() {
  return (
    <span className="disclosure-label" aria-hidden="true">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <path d="M3 8h10" />
        <path className="disclosure-closed" d="M8 3v10" />
      </svg>
    </span>
  )
}

export function CollapseLabel() {
  const gt = useTranslate()
  return (
    <>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3 8h10" />
      </svg>
      <span className="disclosure-accessible-label" data-_gt-hash={translationHash('Hide details')}>
        {gt('Hide details')}
      </span>
    </>
  )
}

export function DisclosureCloseButton() {
  return (
    <button
      type="button"
      className="disclosure-close"
      onClick={(event) => {
        const entry = event.currentTarget.closest('details')
        if (!entry) return
        entry.open = false
        const summary = entry.querySelector('summary')
        summary?.focus({ preventScroll: true })
        summary?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      }}
    >
      <CollapseLabel />
    </button>
  )
}
