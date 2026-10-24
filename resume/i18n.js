import { readFile } from 'node:fs/promises'
import { hashMessage } from 'gt-i18n/internal'

const root = new URL('../', import.meta.url)
const config = JSON.parse(await readFile(new URL('gt.config.json', root), 'utf8'))
export const resumeLocales = [config.defaultLocale, ...config.locales]

export function resumePaths(locale) {
  if (!resumeLocales.includes(locale)) throw new Error(`Unsupported résumé locale: ${locale}`)
  const suffix = locale === config.defaultLocale ? '' : `_${locale}`
  return {
    pdf: `IanResume${suffix}.pdf`,
    data: `resume${suffix}.json`,
    layout: `resume-layout${suffix}.json`,
    content: `resume-content${suffix}.json`,
    report: `resume-orphans${suffix}.json`,
  }
}

export async function loadResumeTranslator(locale) {
  resumePaths(locale)
  const [source, translated] = await Promise.all(
    ['en', locale].map(async (language) =>
      JSON.parse(await readFile(new URL(`src/_gt/${language}.json`, root), 'utf8')),
    ),
  )
  return createResumeTranslator(locale, source, translated)
}

export function createResumeTranslator(locale, source, translated) {
  return (value) => {
    const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/)
    if (!match) return value
    const [, leading, message, trailing] = match
    const key = hashMessage(message, { $format: 'ICU' })
    if (source[key] !== message || typeof translated[key] !== 'string' || !translated[key].trim()) {
      throw new Error(`Missing GT résumé translation (${locale}, ${key}): ${message}`)
    }
    return leading + translated[key] + trailing
  }
}

// Match the website's GT message boundaries, preserving links and emphasis.
export function translateResume(data, translate) {
  function inline(nodes) {
    return nodes.map((node) =>
      node.kind === 'text'
        ? { ...node, value: translate(node.value) }
        : { ...node, children: inline(node.children) },
    )
  }
  function body(nodes) {
    return nodes.map((node) =>
      node.kind === 'paragraph'
        ? { ...node, children: inline(node.children) }
        : { ...node, items: node.items.map(body) },
    )
  }
  return {
    ...data,
    documentTitle: translate('Resume'),
    sections: data.sections.map((section) => ({
      ...section,
      title: translate(section.title),
      ...(section.body ? { body: body(section.body) } : {}),
      ...(section.entries
        ? {
            entries: section.entries.map((entry) => ({
              ...entry,
              ...Object.fromEntries(
                ['title', 'date', 'fact', 'gpa']
                  .filter((key) => entry[key])
                  .map((key) => [key, translate(entry[key])]),
              ),
              ...(entry.body ? { body: body(entry.body) } : {}),
              ...(entry.skills
                ? {
                    skills: entry.skills.map((skill) => ({
                      ...skill,
                      label: skill.language ? skill.label : translate(skill.label),
                    })),
                  }
                : {}),
            })),
          }
        : {}),
    })),
  }
}

export function resumeMessages(data) {
  const messages = new Set()
  translateResume(data, (value) => {
    if (value.trim()) messages.add(value.trim())
    return value
  })
  return [...messages]
}
