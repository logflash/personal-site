import { useCallback, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ian-site-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'dark') return 'dark'
  } catch {
    // localStorage unavailable (e.g. blocked); fall through to default
  }
  return 'light'
}

/**
 * Light/dark theme with localStorage persistence. The theme is applied as
 * `data-theme` on <html>, which drives the CSS custom properties in
 * global.css. The root document's boot script applies the saved value before
 * first paint.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // persistence is best-effort
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { toggleTheme }
}
