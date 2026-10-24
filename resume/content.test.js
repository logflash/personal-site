import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { expectedContent, parseResume } from './content.js'

const source = await readFile(new URL('../src/content/Resume.mdx', import.meta.url), 'utf8')

test('shared résumé keeps PDF-only sections and pre-PhD GPAs', () => {
  const data = parseResume(source)
  assert.deepEqual(
    data.sections.map((section) => section.kind),
    ['summary', 'education', 'experience', 'projects', 'skills'],
  )
  const education = data.sections.find((section) => section.kind === 'education').entries
  assert.equal(education[0].gpa, undefined)
  assert.equal(education.filter((entry) => entry.gpa).length, 4)
  const expected = expectedContent(data)
  assert.equal(expected.dates.length, 19)
  assert.ok(expected.text.includes('Prisma ORM'))
  assert.ok(expected.text.includes('AWS Lambda'))
  assert.ok(expected.text.includes('Marimo'))
  assert.ok(expected.text.includes('Programming Languages'))
  assert.ok(expected.text.includes('Python (Pandas, NumPy, PyTorch, TensorFlow, JAX, MuJoCo, Gym)'))
  assert.equal(expected.text.includes('TypeScript · JavaScript · SQL · Python'), false)
  assert.ok(expected.urls.includes('https://github.com/logflash/rpmml-project'))
})

test('prose and links remain data, including Typst metacharacters and nesting', () => {
  const data = parseResume(`<ResumeCopy>
<ResumePdfOnly>
### Summary
- **A\\* planner** with [a link](https://example.com) and #eval("no") $x$ @name
  - _nested_
    detail
</ResumePdfOnly>
</ResumeCopy>`)
  const expected = expectedContent(data)
  assert.equal(expected.text[1], 'A* planner with a link and #eval("no") $x$ @name')
  assert.equal(expected.text[2], 'nested detail')
  assert.deepEqual(expected.urls, ['https://example.com'])
  assert.equal(data.sections[0].body[0].items[0][0].children[0].kind, 'strong')
})

test('unsupported content and executable MDX attributes fail instead of disappearing', () => {
  assert.throws(() => parseResume('<ResumeCopy><NewSection /></ResumeCopy>'), /Unsupported/)
  assert.throws(
    () =>
      parseResume(`<ResumeCopy>
<MdxSection id="education">
### Education
<ResumeEntry title={"dynamic"} date="2026" fact="degree" />
</MdxSection>
</ResumeCopy>`),
    /literal strings/,
  )
})
