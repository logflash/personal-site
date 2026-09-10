import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createFontInstance,
  parseFontMorphFont,
  shapeFontMorphInstantiatedRun,
  shapeFontMorphRun,
  stableStringify,
} from '../compiler'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function fixture(name: string) {
  const bytes = await readFile(resolve(packageRoot, `demo/public/fonts/${name}`))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

describe('format-2 compiler contracts', () => {
  it('derives stable font identities from bytes, face, and sorted axes', async () => {
    const data = await fixture('source-serif-4-600-outline.ttf')
    const left = createFontInstance({ data, axes: { wght: 600, opsz: 23 } })
    const right = createFontInstance({ data, axes: { opsz: 23, wght: 600 } })
    expect(left).toEqual(right)
    expect(left.sha256).toBe('187d6c27680a374bb352eb7f5a27845be51c18ee64958d2e5d95d918fcd13f91')
  })

  it('shapes generic Latin and Japanese runs deterministically', async () => {
    const latin = parseFontMorphFont({ data: await fixture('ibm-plex-sans-400-outline.ttf') })
    const japanese = parseFontMorphFont({ data: await fixture('noto-sans-jp-400-outline.ttf') })
    const first = shapeFontMorphRun(latin.font, {
      text: 'AV OO',
      fontInstanceId: latin.instance.id,
      features: { liga: false },
    })
    const second = shapeFontMorphRun(latin.font, {
      text: 'AV OO',
      fontInstanceId: latin.instance.id,
      features: { liga: false },
    })
    expect(first).toEqual(second)
    expect(first.glyphs).toHaveLength(5)
    const expectedSecondX =
      first.glyphs[0].advanceWidth +
      latin.font.getKerningValue(
        latin.font.charToGlyph(first.glyphs[0].unicode),
        latin.font.charToGlyph(first.glyphs[1].unicode),
      ) /
        latin.font.unitsPerEm
    expect(first.glyphs[1].x).toBeCloseTo(expectedSecondX, 12)

    const jp = shapeFontMorphRun(japanese.font, {
      text: 'きさ',
      fontInstanceId: japanese.instance.id,
    })
    expect(jp.script).toBe('Jpan')
    expect(jp.glyphs).toHaveLength(2)
  })

  it('rejects unsupported contextual shaping instead of guessing', async () => {
    const parsed = parseFontMorphFont({ data: await fixture('ibm-plex-sans-400-outline.ttf') })
    expect(() =>
      shapeFontMorphRun(parsed.font, {
        text: 'e\u0301',
        fontInstanceId: parsed.instance.id,
      }),
    ).toThrow(/UNSUPPORTED_SHAPING/)
  })

  it('uses variation-aware positioning for compiled runs', async () => {
    const parsed = parseFontMorphFont({
      data: await fixture('source-serif-4-600-outline.ttf'),
      axes: { opsz: 60 },
    })
    const run = shapeFontMorphInstantiatedRun(parsed.outlineFont, {
      text: 'Currículum',
      fontInstanceId: parsed.instance.id,
      language: 'es',
    })
    expect(run.advanceWidth).toBeCloseTo(4.865, 6)
    expect(run.glyphs[4].unicode).toBe('í')
    expect(run.glyphs[4].x).toBeCloseTo(1.936, 6)
    expect(run.glyphs[4].advanceWidth).toBeCloseTo(0.275, 6)
  })

  it('serializes object keys deterministically', () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}')
  })
})
