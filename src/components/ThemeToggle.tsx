import { useGT } from 'gt-react'
import type { Theme } from '../hooks/useTheme'

interface ThemeToggleProps {
  theme: Theme
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const gt = useGT()
  return (
    <button
      type="button"
      className="theme-toggle"
      title={gt('Toggle theme')}
      aria-label={gt('Toggle theme')}
      onClick={onToggle}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
