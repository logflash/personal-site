import { useEffect, useRef, useState } from 'react'

/** True while the viewport is scrolled at all; false at the very top. */
export function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let ticking = false
    const update = () => {
      ticking = false
      setScrolled(window.scrollY > 0)
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return scrolled
}

/**
 * Returns the id of the section currently in view: the last section whose
 * top has scrolled past the offset (or the final section once the page is
 * scrolled to the bottom).
 */
export function useScrollSpy(sectionIds: string[], offset = 120): string {
  const [activeId, setActiveId] = useState(sectionIds[0])
  const activeIdRef = useRef(sectionIds[0])

  useEffect(() => {
    let ticking = false

    const update = () => {
      ticking = false
      let current = sectionIds[0]
      for (const id of sectionIds) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= offset) current = id
      }
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2
      if (atBottom) current = sectionIds[sectionIds.length - 1]
      // Skip React scheduling entirely on the (vast majority of) frames
      // where the active section hasn't changed.
      if (current !== activeIdRef.current) {
        activeIdRef.current = current
        setActiveId(current)
      }
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [sectionIds, offset])

  return activeId
}
