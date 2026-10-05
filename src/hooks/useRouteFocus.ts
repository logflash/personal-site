import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

/** Keep keyboard focus with the mounted route, after its morph has settled. */
export function useRouteFocus() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const previousPath = useRef(pathname)
  const keyboard = useRef(false)
  const origins = useRef(new Map<string, string>())

  useEffect(() => {
    const onKey = () => {
      keyboard.current = true
    }
    const onPointer = () => {
      keyboard.current = false
    }
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
      if (
        !link ||
        link.target === '_blank' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const target = new URL(link.href)
      if (target.origin !== location.origin || target.pathname === location.pathname) return
      keyboard.current = event.detail === 0
      const container = link.closest('.side-nav, .pill-nav, .quick-links')
      const prefix = container ? `.${container.classList[0]} ` : ''
      origins.current.set(
        location.pathname,
        `${prefix}a[href="${CSS.escape(link.getAttribute('href')!)}"]`,
      )
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  useEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    if (!keyboard.current) return
    let frame = 0
    const focus = () => {
      if (document.documentElement.hasAttribute('data-font-morph-active')) {
        frame = requestAnimationFrame(focus)
        return
      }
      if (!keyboard.current || document.querySelector('dialog[open]')) return
      const selector = origins.current.get(pathname)
      const origin = selector
        ? [...document.querySelectorAll<HTMLElement>(selector)].find(
            (element) => element.getClientRects().length > 0,
          )
        : undefined
      const target =
        origin ??
        document.querySelector<HTMLElement>('main h1, main h2') ??
        document.querySelector<HTMLElement>('main')
      if (!target) return
      if (!origin) target.tabIndex = -1
      target.focus({ preventScroll: true })
    }
    // Let the new route mount and register its transition first.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(focus)
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname])
}
