import { profile } from '../data/site'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './localePath'

export const SITE_URL = 'https://ianhenriques.com'

// Meta copy is deliberately maintained by hand: route head() runs outside
// React, so it can't use the gt-react hooks the page content uses.
const DESCRIPTIONS: Record<string, string> = {
  en: 'Ian Henriques — Ph.D. student at MIT working on signal-based foundation models for medical applications.',
  es: 'Ian Henriques — estudiante de doctorado en el MIT, trabajando en foundation models basados en señales para aplicaciones médicas.',
  ja: 'Ian Henriques — MITの博士課程学生。医療応用に向けた信号ベースのfoundation modelに取り組んでいます。',
}

const OG_LOCALES: Record<string, string> = {
  en: 'en_US',
  es: 'es_ES',
  ja: 'ja_JP',
}

/** Route head() payload for a locale page: meta, canonical + hreflang, JSON-LD. */
export function localeHead(locale: string) {
  const description = DESCRIPTIONS[locale] ?? DESCRIPTIONS[DEFAULT_LOCALE]
  const url = `${SITE_URL}/${locale}`
  const image = `${SITE_URL}${profile.avatar}`

  return {
    meta: [
      { title: profile.name },
      { name: 'description', content: description },
      { property: 'og:type', content: 'profile' },
      { property: 'og:title', content: profile.name },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:locale', content: OG_LOCALES[locale] ?? OG_LOCALES[DEFAULT_LOCALE] },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: profile.name },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image },
    ],
    links: [
      { rel: 'canonical', href: url },
      ...SUPPORTED_LOCALES.map((l) => ({
        rel: 'alternate',
        hrefLang: l,
        href: `${SITE_URL}/${l}`,
      })),
      { rel: 'alternate', hrefLang: 'x-default', href: `${SITE_URL}/${DEFAULT_LOCALE}` },
    ],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: profile.name,
          url,
          image,
          jobTitle: 'Ph.D. student',
          affiliation: { '@type': 'Organization', name: 'MIT' },
          sameAs: [
            'https://github.com/logflash',
            'https://www.linkedin.com/in/ian-henriques/',
            'https://x.com/logflash_',
            'https://scholar.google.com/citations?user=PfM704AAAAAJ',
          ],
        }),
      },
    ],
  }
}
