import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const inputs = [
  'src/content/Resume.mdx',
  'resume/main.typ',
  'resume/render.typ',
  'resume/template.typ',
  'resume/i18n.js',
  'resume/content.js',
  'gt.config.json',
]

export async function resumeInputHash(locale = 'en') {
  const hash = createHash('sha256')
  for (const path of [...inputs, 'src/_gt/en.json', `src/_gt/${locale}.json`]) {
    hash
      .update(path)
      .update('\0')
      .update(await readFile(new URL(path, root)))
      .update('\0')
  }
  return hash.digest('hex')
}
