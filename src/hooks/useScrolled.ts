import { useEffect, useState } from 'react'
import { pageScroller } from '../lib/pageScroll'

/** True while the viewport is scrolled at all; false at the very top. */
export function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let ticking = false
    const update = () => {
      ticking = false
      setScrolled(pageScroller().scrollTop > 0)
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    const observer = new MutationObserver(onScroll)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  return scrolled
}
