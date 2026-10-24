import assert from 'node:assert/strict'
import test from 'node:test'
import { findOrphan, paragraphLines } from './check.js'

test('20% is inclusive; longer spillover and standalone short labels pass', () => {
  const full = { text: 'First line', width: 100 }
  assert.equal(findOrphan([full, { text: 'tail', width: 20 }], 100).ratio, 0.2)
  assert.ok(findOrphan([full, { text: 'tail', width: 19 }], 100))
  assert.equal(findOrphan([full, { text: 'tail', width: 20.01 }], 100), null)
  assert.equal(findOrphan([{ text: 'Skills', width: 15 }], 100), null)
  assert.equal(findOrphan([], 100), null)
})

test('PDF line geometry joins formatted spans and excludes neighboring columns', () => {
  const item = (str, x, y, width) => ({ str, width, transform: [9, 0, 0, 9, x, 792 - y] })
  const area = { x: 50, y: 100, width: 100, height: 30 }
  const lines = paragraphLines(
    [
      item('First ', 50, 106, 30),
      item('line', 80, 106, 65),
      item('tail', 50, 117, 20),
      item(' ', 70, 117, 3),
      item('Date label', 170, 106, 70),
      item('Next paragraph', 50, 150, 90),
    ],
    area,
    792,
  )
  assert.deepEqual(lines, [
    { text: 'First line', width: 95 },
    { text: 'tail', width: 20 },
  ])
  assert.equal(findOrphan(lines, area.width).ratio, 0.2)
  // The same 20pt tail occupies 40% of a narrower column and is not an orphan.
  assert.equal(findOrphan(lines, 50), null)
})
