import { formatMessage } from '@generaltranslation/format'
import type { Translation } from 'gt-i18n/types'
import { Fragment, createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { translationHash } from './translationHash'

type Translations = Record<string, Translation>

interface TranslationContextValue {
  locale: string
  translations: Translations
}

const TranslationContext = createContext<TranslationContextValue | null>(null)

export function TranslationProvider({
  locale,
  translations,
  children,
}: TranslationContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, translations }), [locale, translations])
  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}

function useTranslationContext() {
  const value = useContext(TranslationContext)
  if (!value) throw new Error('Translation hooks must be used inside TranslationProvider')
  return value
}

export function useLocale() {
  return useTranslationContext().locale
}

/** Resolve the site's extracted string messages from the server-loaded catalog. */
export function useTranslate() {
  const { translations } = useTranslationContext()
  return useCallback(
    (source: string) => {
      const translated = translations[translationHash(source)]
      return typeof translated === 'string' ? translated : source
    },
    [translations],
  )
}

interface TranslationNode {
  t?: string
  c?: TranslationTree
  k?: string
  v?: string
}

type TranslationTree = string | TranslationNode | TranslationTree[]

function renderTree(
  tree: TranslationTree,
  variables: Record<string, ReactNode>,
  key = 'root',
): ReactNode {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) {
    return tree.map((child, index) => (
      <Fragment key={`${key}-${index}`}>{renderTree(child, variables, `${key}-${index}`)}</Fragment>
    ))
  }
  if (tree.k) return variables[tree.k] ?? null

  // GTJSON is authored by the project's translation pipeline. Keep the
  // renderer deliberately narrow: the only structured message currently
  // contains spans, and an unexpected tag falls back to display:contents.
  const children = tree.c ? renderTree(tree.c, variables, `${key}-c`) : null
  if (tree.t === 'span') return <span>{children}</span>
  return <span style={{ display: 'contents' }}>{children}</span>
}

/** Render a pre-extracted GT JSX message without shipping GT's full client runtime. */
export function StructuredTranslation({
  hash,
  variables,
  children,
}: {
  hash: string
  variables: Record<string, ReactNode>
  children: ReactNode
}) {
  const { translations } = useTranslationContext()
  const translated = translations[hash]
  const content =
    typeof translated === 'object' ? renderTree(translated as TranslationTree, variables) : children

  return (
    <span data-_gt-hash={hash} style={{ display: 'contents' }}>
      {content}
    </span>
  )
}

type IcuVariables = Record<string, string | number>

/** Render an extracted ICU message and preserve enough context for locale-faithful replay. */
export function IcuTranslation({ source, variables }: { source: string; variables: IcuVariables }) {
  const { locale, translations } = useTranslationContext()
  const hash = translationHash(source)
  const translated = translations[hash]
  const template = typeof translated === 'string' ? translated : source
  const content = formatMessage(template, { locales: locale, variables })

  return (
    <span
      data-_gt-hash={hash}
      data-_gt-icu={JSON.stringify(variables)}
      style={{ display: 'contents' }}
    >
      {content}
    </span>
  )
}
