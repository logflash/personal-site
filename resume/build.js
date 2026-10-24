import { createHash } from 'node:crypto'
import { watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler'
import { expectedContent, parseResume } from './content.js'
import { resumeInputHash } from './inputs.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const sourcePath = join(root, 'src/content/Resume.mdx')
const generatedPath = join(root, 'resume/generated/resume.json')
const pdfPaths = ['public/IanResume.pdf', 'output/pdf/IanResume.pdf']
const fontNames = ['AvenirNextLTPro-Light.ttf', 'AvenirNextLTPro-LightItalic.ttf', 'CourierNew.ttf']

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
  await writeChanged(generatedPath, JSON.stringify(data, null, 2) + '\n')
  if (process.argv.includes('--sync-only')) {
    console.log('Synced MDX résumé content for Tinymist')
    return
  }
  // Explicit font blobs make this independent of the host OS's installed fonts.
  const fontBlobs = await Promise.all(
    fontNames.map((name) => readFile(join(root, 'resume/fonts', name))),
  )
  const compiler = NodeCompiler.create({ workspace: root, fontArgs: [{ fontBlobs }] })
  const result = compiler.compile({ mainFilePath: join(root, 'resume/main.typ') })
  if (result.hasError()) {
    result.printDiagnostics()
    throw new Error('Résumé compilation failed')
  }
  const warnings = result.takeWarnings()
  if (warnings) throw new Error(JSON.stringify(warnings.shortDiagnostics, null, 2))
  const pdf = compiler.pdf(result.result)
  const paragraphs = compiler.query(result.result, {
    selector: '<resume-paragraph>',
    field: 'value',
  })
  await writeChanged(
    join(root, 'output/pdf/resume-layout.json'),
    JSON.stringify(
      {
        inputSha256: await resumeInputHash(),
        pdfSha256: createHash('sha256').update(pdf).digest('hex'),
        paragraphs,
      },
      null,
      2,
    ) + '\n',
  )
  await Promise.all(pdfPaths.map((path) => writeChanged(join(root, path), pdf)))
  await writeChanged(
    join(root, 'output/pdf/resume-content.json'),
    JSON.stringify(expectedContent(data), null, 2) + '\n',
  )
  console.log(`Built résumé from MDX (${pdf.length} bytes)`)
}

await build()
if (process.argv.includes('--watch')) {
  let timer
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => build().catch((error) => console.error(error)), 100)
  }
  watch(dirname(sourcePath), (_event, filename) => {
    if (filename?.toString() === 'Resume.mdx') schedule()
  })
  console.log('Watching Resume.mdx; pin resume/main.typ in Tinymist')
}
