import type { Translation } from 'gt-i18n/types'

const translationLoaders = import.meta.glob('./_gt/*.json', { import: 'default' })

/** Loads the locale JSON emitted by `npx gt translate` into src/_gt/. */
export default async function loadTranslations(locale: string) {
  const loader = translationLoaders[`./_gt/${locale}.json`]
  if (!loader) {
    console.warn(`No translations found for ${locale}`)
    return {}
  }

  try {
    return (await loader()) as Record<string, Translation>
  } catch {
    console.warn(`No translations found for ${locale}`)
    return {}
  }
}
