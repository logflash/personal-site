import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { resumeInputHash } from './inputs.js'

const root = new URL('../', import.meta.url)
export const orphanThreshold = 0.2

// Geometry comes from Typst's actual paragraph boxes, not guessed page margins.
// PDF.js supplies the final rendered glyph positions within those boxes.
export function paragraphLines(items, area, pageHeight) {
  const rows = []
  for (const item of items) {
    if (!item.str?.trim()) continue
    const x = item.transform[4]
    const y = pageHeight - item.transform[5]
    if (
      x < area.x - 0.25 ||
      x + item.width > area.x + area.width + 0.25 ||
      y < area.y - 0.25 ||
      y > area.y + area.height + 0.25
    )
      continue
    let row = rows.find((candidate) => Math.abs(candidate.y - y) < 0.25)
    if (!row) rows.push((row = { y, items: [] }))
    row.items.push({ x, width: item.width, text: item.str })
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x)
      return {
        text: row.items
          .map((item) => item.text)
          .join('')
          .trim(),
        width: Math.max(...row.items.map((item) => item.x + item.width)) - row.items[0].x,
      }
    })
}

export function findOrphan(lines, availableWidth) {
  if (lines.length < 2) return null
  const last = lines.at(-1)
  const ratio = last.width / availableWidth
  return ratio <= orphanThreshold + 1e-9 ? { text: last.text, ratio } : null
}

export async function checkResume() {
  const bytes = await readFile(new URL('output/pdf/IanResume.pdf', root))
  const layout = JSON.parse(await readFile(new URL('output/pdf/resume-layout.json', root), 'utf8'))
  if (layout.pdfSha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new Error('PDF and layout measurements differ. Run pnpm resume:build first.')
  }
  if (layout.inputSha256 !== (await resumeInputHash())) {
    throw new Error('Résumé content or template changed. Run pnpm resume:build first.')
  }
  if (!bytes.equals(await readFile(new URL('public/IanResume.pdf', root)))) {
    throw new Error('Website PDF differs from the checked output. Run pnpm resume:build first.')
  }
  if (!layout.paragraphs?.length) throw new Error('PDF has no paragraph measurements')
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false })
  const failures = []
  let wrapped = 0
  try {
    const pdf = await task.promise
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const { items } = await page.getTextContent()
      for (const area of layout.paragraphs.filter((entry) => entry.page === number)) {
        if (!(area.width > 0 && area.height > 0) || area.y + area.height > page.view[3]) {
          throw new Error(
            `Invalid or cross-page paragraph bounds on page ${number}; inspect the PDF layout.`,
          )
        }
        const lines = paragraphLines(items, area, page.view[3])
        if (!lines.length)
          throw new Error(`Unmeasurable paragraph on page ${number} at ${area.y.toFixed(1)}pt`)
        if (lines.length > 1) wrapped++
        const orphan = findOrphan(lines, area.width)
        if (orphan)
          failures.push({
            page: number,
            paragraph: lines.map((line) => line.text).join(' '),
            ...orphan,
          })
      }
    }
  } finally {
    await task.destroy()
  }
  await writeFile(
    new URL('output/pdf/resume-orphans.json', root),
    JSON.stringify({ threshold: orphanThreshold, wrapped, failures }, null, 2) + '\n',
  )
  if (failures.length) {
    for (const failure of failures) {
      console.error(
        `Page ${failure.page}: orphan "${failure.text}" uses ${(failure.ratio * 100).toFixed(1)}% of its line (limit: 20%).\n  ${failure.paragraph}`,
      )
    }
    throw new Error(
      `${failures.length} orphaned line(s). Fix the layout and run pnpm resume:build again.`,
    )
  }
  console.log(
    `Résumé check passed: ${layout.paragraphs.length} paragraphs, ${wrapped} wrapped; no spillover lines at or below 20%.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkResume().catch((error) => {
    console.error(
      error.code === 'ENOENT'
        ? 'Résumé output is missing. Run pnpm resume:build first.'
        : error.message,
    )
    process.exitCode = 1
  })
}
