import { useCallback, useEffect } from 'react'
import { THEME_STORAGE_KEY } from '../lib/theme'

/**
 * Follow the browser until a visitor chooses a theme. The pre-paint script
 * initializes the same DOM state, so hydration never swaps the theme/icon.
 */
export function useTheme() {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.dataset.theme = root.dataset.themePreference || (media.matches ? 'dark' : 'light')
    }
    const syncStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea !== localStorage) return
      } catch {
        return
      }
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
      if (event.newValue === 'light' || event.newValue === 'dark') {
        root.dataset.themePreference = event.newValue
      } else {
        delete root.dataset.themePreference
      }
      apply()
    }
    apply()
    media.addEventListener('change', apply)
    window.addEventListener('storage', syncStorage)
    return () => {
      media.removeEventListener('change', apply)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    const root = document.documentElement
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.themePreference = theme
    root.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Keep the explicit choice for this document even if storage is blocked.
    }
  }, [])

  return { toggleTheme }
}
