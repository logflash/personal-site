import { languages } from './catalog'

interface DemoHeaderProps {
  locale: string
  title: string
  selectId: string
  onLocaleChange: (locale: string) => void
}

export function DemoHeader({ locale, title, selectId, onLocaleChange }: DemoHeaderProps) {
  return (
    <header className="demo-header">
      <div>
        <p className="eyebrow">Glyphflux</p>
        <h1>{title}</h1>
      </div>
      <label className="locale-control" htmlFor={selectId}>
        <span>Language</span>
        <select
          id={selectId}
          value={locale}
          onChange={(event) => onLocaleChange(event.target.value)}
        >
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}
