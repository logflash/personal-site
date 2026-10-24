import { createHash } from 'node:crypto'
import { watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler'
import { expectedContent, parseResume } from './content.js'
import { resumeInputHash } from './inputs.js'
import { loadResumeTranslator, resumeLocales, resumePaths, translateResume } from './i18n.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const sourcePath = join(root, 'src/content/Resume.mdx')
const fontNames = [
  'AvenirNextLTPro-Light.ttf',
  'AvenirNextLTPro-LightItalic.ttf',
  'CourierNew.ttf',
  'NotoSansJP-Light.ttf',
]

async function writeChanged(path, content) {
  const previous = await readFile(path).catch(() => null)
  const bytes = Buffer.from(content)
  if (previous?.equals(bytes)) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

async function build() {
  const source = await readFile(sourcePath, 'utf8')
  const data = {
    source: 'src/content/Resume.mdx',
    sha256: createHash('sha256').update(source).digest('hex'),
    ...parseResume(source),
  }
  const localized = await Promise.all(
    resumeLocales.map(async (locale) => ({
      locale,
      ...translateResume(data, await loadResumeTranslator(locale)),
    })),
  )
  for (const translated of localized) {
    const paths = resumePaths(translated.locale)
    await writeChanged(
      join(root, 'resume/generated', paths.data),
      JSON.stringify(translated, null, 2) + '\n',
    )
  }
  if (process.argv.includes('--sync-only')) {
    console.log(`Synced GT résumé content for Tinymist (${resumeLocales.join(', ')})`)
    return
  }
  // Explicit fonts keep all locales independent of the host OS's font cache.
  const fontBlobs = await Promise.all(
    fontNames.map((name) => readFile(join(root, 'resume/fonts', name))),
  )
  const compiler = NodeCompiler.create({ workspace: root, fontArgs: [{ fontBlobs }] })
  for (const translated of localized) {
    const { locale } = translated
    const paths = resumePaths(locale)
    const result = compiler.compile({
      mainFilePath: join(root, 'resume/main.typ'),
      inputs: { locale },
    })
    if (result.hasError()) {
      result.printDiagnostics()
      throw new Error(`Résumé compilation failed (${locale})`)
    }
    const warnings = result.takeWarnings()
    if (warnings)
      throw new Error(`${locale}: ${JSON.stringify(warnings.shortDiagnostics, null, 2)}`)
    const pdf = compiler.pdf(result.result)
    const paragraphs = compiler.query(result.result, {
      selector: '<resume-paragraph>',
      field: 'value',
    })
    await writeChanged(
      join(root, 'output/pdf', paths.layout),
      JSON.stringify(
        {
          locale,
          inputSha256: await resumeInputHash(locale),
          pdfSha256: createHash('sha256').update(pdf).digest('hex'),
          paragraphs,
        },
        null,
        2,
      ) + '\n',
    )
    await Promise.all(
      ['public', 'output/pdf'].map((directory) =>
        writeChanged(join(root, directory, paths.pdf), pdf),
      ),
    )
    await writeChanged(
      join(root, 'output/pdf', paths.content),
      JSON.stringify(expectedContent(translated), null, 2) + '\n',
    )
    console.log(`Built ${paths.pdf} from GT (${pdf.length} bytes)`)
  }
}

await build()
if (process.argv.includes('--watch')) {
  let timer
  let running = false
  let pending = false
  async function rebuild() {
    if (running) {
      pending = true
      return
    }
    running = true
    do {
      pending = false
      await build().catch((error) => console.error(error))
    } while (pending)
    running = false
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(rebuild, 100)
  }
  watch(dirname(sourcePath), (_event, filename) => {
    if (filename?.toString() === 'Resume.mdx') schedule()
  })
  watch(join(root, 'src/_gt'), (_event, filename) => {
    if (resumeLocales.some((locale) => filename?.toString() === `${locale}.json`)) schedule()
  })
  watch(join(root, 'resume'), (_event, filename) => {
    if (filename?.toString().endsWith('.typ')) schedule()
  })
  console.log('Watching résumé MDX, GT catalogs and Typst layouts; pin resume/main.typ in Tinymist')
}
