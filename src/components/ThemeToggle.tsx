import { useGT } from 'gt-react'

interface ThemeToggleProps {
  onToggle: () => void
}

export function ThemeToggle({ onToggle }: ThemeToggleProps) {
  const gt = useGT()
  return (
    <button
      type="button"
      className="theme-toggle"
      title={gt('Toggle theme')}
      aria-label={gt('Toggle theme')}
      onClick={onToggle}
    >
      <span className="theme-icon theme-icon-sun" aria-hidden="true">
        ☀
      </span>
      <span className="theme-icon theme-icon-moon" aria-hidden="true">
        ☾
      </span>
    </button>
  )
}
