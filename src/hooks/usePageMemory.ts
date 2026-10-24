import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  captureSnapshot,
  initialSnapshot,
  pageMemory,
  persistPageMemory,
  readValue,
  rememberValue,
  restoreValues,
  RESTORE_VALUES_EVENT,
  type ReadingSnapshot,
} from '../lib/pageMemory'

/** Restore after hydration, so the server and client's first render agree. */
export function useRememberedState<T extends string | boolean>(key: string, initial: T) {
  const [value, setValue] = useState(initial)
  const current = useRef(value)
  current.current = value
  useLayoutEffect(() => {
    const restore = () => {
      const saved = readValue(key)
      const next = typeof saved === typeof initial ? (saved as T) : initial
      current.current = next
      setValue(next)
    }
    restore()
    document.addEventListener(RESTORE_VALUES_EVENT, restore)
    return () => document.removeEventListener(RESTORE_VALUES_EVENT, restore)
  }, [key, initial])
  const remember: Dispatch<SetStateAction<T>> = (next) => {
    const resolved = typeof next === 'function' ? next(current.current) : next
    current.current = resolved
    rememberValue(key, resolved)
    setValue(resolved)
  }
  return [value, remember] as const
}

export function useRememberedDisclosure(key: string) {
  const ref = useRef<HTMLDetailsElement>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const element = ref.current
    const restore = () => {
      element.open =
        Boolean(element.id && location.hash === `#${element.id}`) || readValue(key) === true
    }
    restore()
    const save = () => rememberValue(key, element.open)
    element.addEventListener('toggle', save)
    document.addEventListener(RESTORE_VALUES_EVENT, restore)
    return () => {
      element.removeEventListener('toggle', save)
      document.removeEventListener(RESTORE_VALUES_EVENT, restore)
    }
  }, [key])
  return ref
}

/** One owner of restoration; UI state is restored by child layout effects first. */
export function usePageMemory() {
  const router = useRouter()
  useLayoutEffect(() => {
    const memory = pageMemory()
    let currentPath = location.pathname
    let currentEntry = router.state.location.state.__TSR_key ?? currentPath
    let frame = 0
    let restoring = false
    let disposed = false
    let generation = 0
    let pending = initialSnapshot()
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'

    const save = () => {
      if (restoring || document.querySelector('.replay-overlay')) return
      // The recorder uses a scaled, separately scrolling content frame.
      // Do not replace a normal reading position with its temporary geometry.
      if (document.documentElement.style.getPropertyValue('--gt-capture-scale')) return
      memory.entries[currentEntry] = captureSnapshot()
      persistPageMemory()
    }

    const restore = (snapshot: ReadingSnapshot | undefined, hash: string) => {
      const position = snapshot?.position
      const run = ++generation
      restoring = true
      const apply = () => {
        if (disposed || run !== generation) return
        const graph = document.querySelector<HTMLElement>('.cg-scroller')
        if (graph && position?.graphX !== undefined) graph.scrollLeft = position.graphX
        let y = position?.y ?? 0
        if (position?.anchor && position.offset !== undefined && position.y > 0) {
          const anchor = [
            ...document.querySelectorAll<HTMLElement>('main [data-reading-anchor]'),
          ].find((element) => element.dataset.readingAnchor === position.anchor)
          if (anchor?.getClientRects().length) {
            y = window.scrollY + anchor.getBoundingClientRect().top - position.offset
          }
        }
        if (!position && hash) {
          let target: HTMLElement | null = null
          try {
            target = document.getElementById(decodeURIComponent(hash))
          } catch {
            /* Invalid hash. */
          }
          if (hash !== 'home' && target) target.scrollIntoView({ behavior: 'instant' })
          else if (hash === 'home') window.scrollTo({ top: 0, behavior: 'instant' })
        } else {
          window.scrollTo({ top: y, behavior: 'instant' })
        }
        restoring = false
      }
      cancelAnimationFrame(frame)
      // Router scrolling and disclosure hydration complete before measuring.
      frame = requestAnimationFrame(apply)
    }

    const before = router.subscribe('onBeforeNavigate', ({ toLocation, pathChanged }) => {
      save()
      pending = memory.entries[toLocation.state.__TSR_key ?? '']
      // Explicit hash links preserve the current page's disclosures.
      // A newly pushed page starts fresh; history entries restore their own state.
      if (pathChanged || pending) restoreValues(pending)
      restoring = true
    })
    const rendered = router.subscribe('onRendered', ({ toLocation, hashChanged }) => {
      currentPath = toLocation.pathname
      currentEntry = toLocation.state.__TSR_key ?? currentPath
      // Router links use pushState, which does not emit hashchange. Keep the
      // existing section highlight and hash-driven disclosures synchronized.
      if (hashChanged) window.dispatchEvent(new HashChangeEvent('hashchange'))
      restore(pending, toLocation.hash)
    })
    const onScroll = () => {
      if (!restoring) save()
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('scrollend', onScroll, true)
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHidden)
    // Capture before native links or the router change the active history entry.
    document.addEventListener('click', save, true)
    delete memory.language
    persistPageMemory()
    restore(pending, location.hash.slice(1))
    return () => {
      save()
      disposed = true
      cancelAnimationFrame(frame)
      before()
      rendered()
      document.removeEventListener('scrollend', onScroll, true)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHidden)
      document.removeEventListener('click', save, true)
      history.scrollRestoration = previousRestoration
    }
  }, [router])
}
