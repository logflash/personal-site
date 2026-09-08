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
  } catch (error) {
    console.warn(`No translations found for ${locale}`, error)
    // Let GT's resource cache observe the rejection. Returning an empty object
    // here would cache a transient Vite/HMR import failure for the life of the
    // process and silently render that locale in English.
    throw error
  }
}
