import { t } from 'gt-react'
import type { Theme } from '../hooks/useTheme'

interface ThemeToggleProps {
  theme: Theme
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      className="theme-toggle"
      title={t('Toggle theme')}
      aria-label={t('Toggle theme')}
      onClick={onToggle}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
