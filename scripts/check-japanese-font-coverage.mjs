import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as fontkit from 'fontkit'
import { japaneseFontText } from './japanese-font-text.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const required = [...(await japaneseFontText(projectRoot))]
const fonts = [
  ['noto-sans-jp-400-subset.woff2', 400],
  ['noto-sans-jp-600-subset.woff2', 600],
  ['noto-serif-jp-600-subset.woff2', 600],
]

for (const [name, expectedWeight] of fonts) {
  const font = fontkit.openSync(resolve(projectRoot, 'public/fonts', name))
  const supported = new Set(font.characterSet)
  const missing = required.filter((character) => !supported.has(character.codePointAt(0)))

  if (missing.length > 0) {
    throw new Error(`${name} is missing Japanese catalog characters: ${missing.join('')}`)
  }

  const actualWeight = font['OS/2']?.usWeightClass
  if (actualWeight !== expectedWeight) {
    throw new Error(`${name} has weight ${actualWeight}; expected ${expectedWeight}`)
  }
}

console.log(
  `Japanese font subsets have the expected weights and cover all ${required.length} non-ASCII catalog characters.`,
)
