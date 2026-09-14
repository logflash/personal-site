import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { japaneseFontText } from './japanese-font-text.mjs'

const googleFontsCommit = '809e4d8b8d7e9364a914909bb777679606c178b8'
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const fontDirectory = resolve(projectRoot, 'public/fonts')
const rawRoot = `https://raw.githubusercontent.com/google/fonts/${googleFontsCommit}/ofl`
const outputs = [
  {
    family: 'notosansjp',
    source: 'NotoSansJP%5Bwght%5D.ttf',
    weight: 400,
    output: 'noto-sans-jp-400-subset.woff2',
  },
  {
    family: 'notosansjp',
    source: 'NotoSansJP%5Bwght%5D.ttf',
    weight: 600,
    output: 'noto-sans-jp-600-subset.woff2',
  },
  {
    family: 'notoserifjp',
    source: 'NotoSerifJP%5Bwght%5D.ttf',
    weight: 600,
    output: 'noto-serif-jp-600-subset.woff2',
  },
]

function run(command, arguments_) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' })
    child.once('error', (error) =>
      reject(new Error(`Unable to run ${command}. Install fonttools first.`, { cause: error })),
    )
    child.once('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'personal-site-japanese-fonts-'))
try {
  const textPath = resolve(temporaryDirectory, 'characters.txt')
  await writeFile(textPath, await japaneseFontText(projectRoot), 'utf8')

  const sourcePaths = new Map()
  for (const { family, source } of outputs) {
    const key = `${family}/${source}`
    if (sourcePaths.has(key)) continue

    const url = `${rawRoot}/${key}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`)
    const sourcePath = resolve(
      temporaryDirectory,
      basename(source).replaceAll('%5B', '[').replaceAll('%5D', ']'),
    )
    await writeFile(sourcePath, new Uint8Array(await response.arrayBuffer()))
    sourcePaths.set(key, sourcePath)
  }

  for (const { family, source, weight, output } of outputs) {
    const sourcePath = sourcePaths.get(`${family}/${source}`)
    const instancePath = resolve(temporaryDirectory, `${weight}-${basename(sourcePath)}`)
    const outputPath = resolve(fontDirectory, output)

    await run('fonttools', [
      'varLib.instancer',
      sourcePath,
      `wght=${weight}`,
      `--output=${instancePath}`,
      '--update-name-table',
      '--no-recalc-timestamp',
    ])
    await run('pyftsubset', [
      instancePath,
      `--output-file=${outputPath}`,
      `--text-file=${textPath}`,
      '--flavor=woff2',
      '--layout-features=*',
      '--glyph-names',
      '--symbol-cmap',
      '--legacy-cmap',
      '--notdef-glyph',
      '--notdef-outline',
      '--recommended-glyphs',
      '--name-IDs=*',
      '--name-legacy',
      '--name-languages=*',
      '--no-recalc-timestamp',
    ])

    const bytes = await readFile(outputPath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    console.log(`${output}\t${bytes.length} bytes\t${hash}`)
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
