import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { hashMessage } from 'gt-i18n/internal'
import { expectedContent, parseResume } from './content.js'
import {
  createResumeTranslator,
  loadResumeTranslator,
  resumeLocales,
  resumePaths,
  translateResume,
} from './i18n.js'

const source = parseResume(
  await readFile(new URL('../src/content/Resume.mdx', import.meta.url), 'utf8'),
)

test('GT catalog lookup preserves boundaries and rejects missing translations', () => {
  const key = hashMessage('Summary', { $format: 'ICU' })
  const translate = createResumeTranslator('es', { [key]: 'Summary' }, { [key]: 'Perfil' })
  assert.equal(translate(' Summary '), ' Perfil ')
  assert.equal(translate('  '), '  ')
  assert.throws(() => translate('New wording'), /Missing GT résumé translation/)
  assert.throws(
    () => createResumeTranslator('ja', { [key]: 'Summary' }, {})('Summary'),
    /Missing GT/,
  )
})

test('all GT locales translate the complete résumé while retaining links and technical names', async () => {
  for (const locale of resumeLocales) {
    const result = translateResume(source, await loadResumeTranslator(locale))
    const expected = expectedContent(result)
    assert.equal(expected.dates.length, 19)
    assert.deepEqual(expected.urls, expectedContent(source).urls)
    const education = result.sections.find((section) => section.kind === 'education').entries
    assert.equal(education.filter((entry) => entry.gpa).length, 4)
    assert.equal(education[0].gpa, undefined)
    const python = result.sections.find((section) => section.kind === 'skills').entries[0].skills[0]
    assert.equal(python.label, 'Python')
    assert.equal(python.pdfDetail, 'Pandas, NumPy, PyTorch, TensorFlow, JAX, MuJoCo, Gym')
    assert.equal(result.sections[0].title, { en: 'Summary', es: 'Perfil', ja: '概要' }[locale])
    if (locale !== 'en')
      assert.notEqual(
        result.sections[0].body[0].items[0][0].children[0].value,
        source.sections[0].body[0].items[0][0].children[0].value,
      )
  }
})

test('download filenames match locale; unsupported locales cannot form paths', () => {
  assert.equal(resumePaths('en').pdf, 'IanResume.pdf')
  assert.equal(resumePaths('es').pdf, 'IanResume_es.pdf')
  assert.equal(resumePaths('ja').pdf, 'IanResume_ja.pdf')
  assert.throws(() => resumePaths('../es'), /Unsupported/)
})
