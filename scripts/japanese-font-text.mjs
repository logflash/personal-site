import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function collectStrings(value, strings) {
  if (typeof value === 'string') {
    strings.push(value)
    return
  }

  if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, strings)
    return
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectStrings(child, strings)
  }
}

export async function japaneseFontText(projectRoot) {
  const catalog = JSON.parse(await readFile(resolve(projectRoot, 'src/_gt/ja.json'), 'utf8'))
  const strings = ['日本語']
  collectStrings(catalog, strings)

  return [...new Set(strings.join('').normalize('NFC'))]
    .filter((character) => character.codePointAt(0) > 0x7f)
    .sort((left, right) => left.codePointAt(0) - right.codePointAt(0))
    .join('')
}
