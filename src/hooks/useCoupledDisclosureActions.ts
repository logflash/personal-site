import { useLayoutEffect, type RefObject } from 'react'

function actionIsOnOwnLine(entry: HTMLElement): boolean {
  const action = entry.querySelector<HTMLElement>(
    '.resume-entry-action, .resume-entry-languages > .disclosure-label',
  )
  const row = action?.parentElement
  if (!action || !row) return false

  const rowStyle = getComputedStyle(row)
  const gridWrap = rowStyle.getPropertyValue('--disclosure-action-natural-wrap').trim()
  if (gridWrap) return gridWrap === '1'

  const lastItem = action.previousElementSibling
  const icon = action.querySelector('svg')
  if (!lastItem || !icon) return false

  const rowRect = row.getBoundingClientRect()
  const itemRect = lastItem.getBoundingClientRect()
  const iconWidth = icon.getBoundingClientRect().width
  const gap = Number.parseFloat(rowStyle.columnGap) || 0
  if (rowStyle.direction === 'rtl') {
    return (
      itemRect.left - gap - iconWidth < rowRect.left + Number.parseFloat(rowStyle.paddingLeft) - 0.5
    )
  }
  return (
    itemRect.right + gap + iconWidth >
    rowRect.right - Number.parseFloat(rowStyle.paddingRight) + 0.5
  )
}

export function useCoupledDisclosureActions(
  sectionRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!enabled || !section) return

    let disposed = false
    let measuredWidth = -1
    const measure = () => {
      if (disposed) return
      const shouldWrap = Array.from(section.querySelectorAll<HTMLElement>('.resume-entry')).some(
        actionIsOnOwnLine,
      )
      if (section.hasAttribute('data-coupled-disclosure-wrapped') !== shouldWrap) {
        section.toggleAttribute('data-coupled-disclosure-wrapped', shouldWrap)
      }
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (Math.abs(width - measuredWidth) < 0.5) return
      measuredWidth = width
      measure()
    })
    resizeObserver.observe(section)

    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(section, { childList: true, characterData: true, subtree: true })

    window.addEventListener('resize', measure)
    document.fonts.addEventListener('loadingdone', measure)
    void document.fonts.ready.then(measure)
    measure()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', measure)
      document.fonts.removeEventListener('loadingdone', measure)
    }
  }, [sectionRef, enabled])
}
