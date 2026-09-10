import { createProcessor } from '@mdx-js/mdx'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFontMorphManifest, fontMorphPreparedKey } from '../repos/font-morph/dist/index.mjs'
import {
  compileSdfGlyphPairs,
  parseFontMorphFont,
  shapeFontMorphInstantiatedRun,
  stableStringify,
} from '../repos/font-morph/dist/compiler/index.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gtConfig = JSON.parse(await readFile(resolve(projectRoot, 'gt.config.json'), 'utf8'))
const locales = [gtConfig.defaultLocale, ...gtConfig.locales]
const contentDirectory = resolve(projectRoot, 'src/content')
const publicFontDirectory = resolve(projectRoot, 'public/fonts')
const globalCss = await readFile(resolve(projectRoot, 'src/styles/global.css'), 'utf8')
const morphCss = await readFile(resolve(projectRoot, 'repos/font-morph/styles.css'), 'utf8')

function plainText(node, sourcePath) {
  if (node.type === 'text') return node.value
  if (Array.isArray(node.children) && node.children.every((child) => child.type === 'text')) {
    return node.children.map((child) => child.value).join('')
  }
  throw new Error(`${sourcePath}: font-morph headings must contain plain text`)
}

function stringAttribute(node, name) {
  const attribute = node.attributes?.find(
    (candidate) => candidate.type === 'mdxJsxAttribute' && candidate.name === name,
  )
  return typeof attribute?.value === 'string' ? attribute.value : undefined
}

function hasAttribute(node, name) {
  return node.attributes?.some(
    (candidate) => candidate.type === 'mdxJsxAttribute' && candidate.name === name,
  )
}

function collectTransitionMessages(node, sourceMessages, destinationMessages, sourcePath) {
  if (node.type === 'heading' && node.depth === 1) {
    const message = plainText(node, sourcePath).trim()
    if (message) destinationMessages.add(message)
  }
  if (
    (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
    node.name === 'QuickLink' &&
    hasAttribute(node, 'resume')
  ) {
    const message = stringAttribute(node, 'translatedLabel')?.trim()
    if (!message) {
      throw new Error(`${sourcePath}: transitioning QuickLink requires translatedLabel`)
    }
    sourceMessages.add(message)
  }
  for (const child of node.children ?? []) {
    collectTransitionMessages(child, sourceMessages, destinationMessages, sourcePath)
  }
}

async function discoverTransitionMessages() {
  const processor = createProcessor({ format: 'mdx' })
  const sourceMessages = new Set()
  const destinationMessages = new Set()
  const contentFiles = (await readdir(contentDirectory))
    .filter((name) => name.endsWith('.mdx'))
    .sort()
  for (const name of contentFiles) {
    const path = resolve(contentDirectory, name)
    collectTransitionMessages(
      processor.parse(await readFile(path, 'utf8')),
      sourceMessages,
      destinationMessages,
      relative(projectRoot, path),
    )
  }
  const messages = [...sourceMessages].filter((message) => destinationMessages.has(message)).sort()
  if (!messages.length) {
    throw new Error('No matching font-morph source link and destination heading were found in MDX')
  }
  for (const message of sourceMessages) {
    if (!destinationMessages.has(message)) {
      throw new Error(`Font-morph source ${JSON.stringify(message)} has no matching MDX h1`)
    }
  }
  return messages
}

function cssVariable(css, name) {
  const values = [...css.matchAll(new RegExp(`--${name}\\s*:\\s*([^;]+)`, 'g'))].map((match) =>
    match[1].trim(),
  )
  if (!values.length) throw new Error(`Unable to find CSS variable --${name}`)
  return values
}

function fontRoleForSelector(css, selector) {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(',').some((value) => value.trim() === selector)) continue
    const role = match[2].match(/font-family\s*:\s*var\(--font-(sans|serif)\)/)?.[1]
    if (role) return role
  }
  throw new Error(`${selector} must declare var(--font-sans) or var(--font-serif)`)
}

function fontStack(role) {
  return cssVariable(globalCss, `font-${role}`)[0]
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
}

function familySlug(family) {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function discoverOutlineFiles(role) {
  const available = (await readdir(publicFontDirectory))
    .filter((name) => name.endsWith('-outline.ttf'))
    .sort()
  const selected = fontStack(role).flatMap((family) => {
    const prefix = `${familySlug(family)}-`
    return available.filter((name) => name.startsWith(prefix))
  })
  if (!selected.length) throw new Error(`No outline fonts match the --font-${role} CSS stack`)
  return selected.map((name) => `public/fonts/${name}`)
}

function numericMorphValues(name, fallback) {
  const matches = [
    ...`${morphCss}\n${globalCss}`.matchAll(
      new RegExp(`--${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g'),
    ),
  ].map((match) => Number(match[1]))
  return [...new Set(matches.length ? matches : [fallback])].sort((left, right) => left - right)
}

async function arrayBuffer(path) {
  const value = await readFile(resolve(projectRoot, path))
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

function variationAxes(instance, outlineFont) {
  const available = outlineFont.variationAxes ?? {}
  return {
    ...(available.wght ? { wght: instance.weight } : {}),
    ...(available.opsz && instance.opticalSize > 0 ? { opsz: instance.opticalSize } : {}),
  }
}

function supportsText(outlineFont, text) {
  return [...text].every(
    (character) =>
      character === '\0' || outlineFont.glyphForCodePoint(character.codePointAt(0)).id !== 0,
  )
}

function selectFont(fontSources, instance, text) {
  for (const source of fontSources[instance.role]) {
    const uninstantiated = parseFontMorphFont({ data: source.data })
    if (!supportsText(uninstantiated.outlineFont, text)) continue
    const axes = variationAxes(instance, uninstantiated.outlineFont)
    const input = {
      data: source.data,
      ...(Object.keys(axes).length ? { axes } : {}),
    }
    return { ...source, input, parsed: parseFontMorphFont(input) }
  }
  throw new Error(`No --font-${instance.role} outline contains ${JSON.stringify(text)}`)
}

function serializedGlyph(glyph) {
  const { distance: sourceDistance, ...source } = glyph.source
  const { distance: targetDistance, ...target } = glyph.target
  return {
    ...glyph,
    source: {
      ...source,
      distanceBase64: Buffer.from(sourceDistance).toString('base64'),
    },
    target: {
      ...target,
      distanceBase64: Buffer.from(targetDistance).toString('base64'),
    },
  }
}

const catalogs = Object.fromEntries(
  await Promise.all(
    locales.map(async (locale) => [
      locale,
      JSON.parse(await readFile(resolve(projectRoot, `src/_gt/${locale}.json`), 'utf8')),
    ]),
  ),
)
const sourceMessages = await discoverTransitionMessages()
const hashes = Object.fromEntries(
  sourceMessages.map((message) => {
    const hash = Object.entries(catalogs[gtConfig.defaultLocale]).find(
      ([, value]) => value === message,
    )?.[0]
    if (!hash)
      throw new Error(
        `Unable to find font-morph message ${JSON.stringify(message)} in the source catalog`,
      )
    return [message, hash]
  }),
)
const texts = Object.fromEntries(
  locales.map((locale) => [
    locale,
    sourceMessages.map((message) => {
      const value = catalogs[locale][hashes[message]]
      if (typeof value !== 'string') {
        throw new Error(`${JSON.stringify(message)} must be a string in ${locale}.json`)
      }
      return value
    }),
  ]),
)

// Component styling determines the two font roles. Responsive CSS variables
// determine every font instance that can appear at runtime; MDX and the locale
// catalogs determine the text and therefore the complete character set.
const sourceRole = fontRoleForSelector(globalCss, '.resume-link')
const targetRole = fontRoleForSelector(globalCss, '.transition-page-title')
const sourceWeights = numericMorphValues(`font-morph-${sourceRole}-weight`, 400)
const targetWeights = numericMorphValues(`font-morph-${targetRole}-weight`, 400)
const sourceOpticalSizes = numericMorphValues(`font-morph-${sourceRole}-optical-size`, 0)
const targetOpticalSizes = numericMorphValues(`font-morph-${targetRole}-optical-size`, 0)
const requests = locales.flatMap((locale) =>
  texts[locale].flatMap((text) =>
    sourceWeights.flatMap((sourceWeight) =>
      sourceOpticalSizes.flatMap((sourceOpticalSize) =>
        targetWeights.flatMap((targetWeight) =>
          targetOpticalSizes.map((targetOpticalSize) => ({
            text,
            source: {
              role: sourceRole,
              weight: sourceWeight,
              opticalSize: sourceOpticalSize,
            },
            target: {
              role: targetRole,
              weight: targetWeight,
              opticalSize: targetOpticalSize,
            },
          })),
        ),
      ),
    ),
  ),
)
const outlineFiles = {
  sans: await discoverOutlineFiles('sans'),
  serif: await discoverOutlineFiles('serif'),
}
const fontSources = {
  sans: await Promise.all(
    outlineFiles.sans.map(async (file) => ({ file, data: await arrayBuffer(file) })),
  ),
  serif: await Promise.all(
    outlineFiles.serif.map(async (file) => ({ file, data: await arrayBuffer(file) })),
  ),
}
const buffers = Object.fromEntries(
  Object.entries(fontSources).map(([role, sources]) => [
    role,
    sources.map((source) => source.data),
  ]),
)
const manifest = await compileFontMorphManifest(buffers, requests)
// Resolve fallback faces and supported variation axes from the CSS-selected
// stacks. Equivalent font-instance pairs share one SDF compilation so adding
// locales or repeated text does not multiply build work.
const sdfPlans = requests.map((request) => {
  const sourceFont = selectFont(fontSources, request.source, request.text)
  const targetFont = selectFont(fontSources, request.target, request.text)
  return {
    request,
    sourceFont,
    targetFont,
    groupKey: stableStringify({
      sourceFile: sourceFont.file,
      sourceAxes: sourceFont.parsed.instance.axes,
      targetFile: targetFont.file,
      targetAxes: targetFont.parsed.instance.axes,
    }),
  }
})
const sdfGroups = new Map()
for (const plan of sdfPlans) {
  const group = sdfGroups.get(plan.groupKey) ?? { plans: [], characters: new Set() }
  group.plans.push(plan)
  for (const character of plan.request.text) group.characters.add(character)
  sdfGroups.set(plan.groupKey, group)
}
const compiledSdfGroups = new Map()
for (const [groupKey, group] of [...sdfGroups].sort(([left], [right]) =>
  left < right ? -1 : left > right ? 1 : 0,
)) {
  const [{ sourceFont, targetFont }] = group.plans
  const glyphs = compileSdfGlyphPairs(
    sourceFont.input,
    targetFont.input,
    [...group.characters].sort(),
    {
      size: 128,
      pixelsPerEm: 512,
      maximumDistance: 64,
      supersampling: 4,
    },
  )
  compiledSdfGroups.set(
    groupKey,
    Object.fromEntries(glyphs.map((glyph) => [glyph.unicode, serializedGlyph(glyph)])),
  )
}
const sdfMorphs = Object.fromEntries(
  sdfPlans
    .map(({ request, sourceFont, targetFont, groupKey }) => [
      fontMorphPreparedKey(request.text, request.source, request.target),
      {
        sourceRun: shapeFontMorphInstantiatedRun(sourceFont.parsed.outlineFont, {
          text: request.text,
          fontInstanceId: sourceFont.parsed.instance.id,
          language: locales.find((locale) => texts[locale].includes(request.text)) ?? 'und',
        }),
        targetRun: shapeFontMorphInstantiatedRun(targetFont.parsed.outlineFont, {
          text: request.text,
          fontInstanceId: targetFont.parsed.instance.id,
          language: locales.find((locale) => texts[locale].includes(request.text)) ?? 'und',
        }),
        glyphs: Object.fromEntries(
          [...new Set(request.text)]
            .sort()
            .map((character) => [character, compiledSdfGroups.get(groupKey)[character]]),
        ),
      },
    ])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
)
const outputDirectory = resolve(projectRoot, 'public/font-morph')
await mkdir(outputDirectory, { recursive: true })

for (const locale of locales) {
  const localeTexts = new Set(texts[locale])
  const outlines = Object.fromEntries(
    Object.entries(manifest.outlines).filter(([key]) => localeTexts.has(JSON.parse(key)[0])),
  )
  const localeSdfMorphs = Object.fromEntries(
    Object.entries(sdfMorphs).filter(([key]) => localeTexts.has(JSON.parse(key)[0])),
  )
  await writeFile(
    resolve(outputDirectory, `${locale}.json`),
    `${stableStringify({ version: 2, outlines, sdfMorphs: localeSdfMorphs })}\n`,
  )
}

const generatedDirectory = resolve(projectRoot, 'src/generated')
await mkdir(generatedDirectory, { recursive: true })
const localeByText = {}
for (const locale of locales) {
  for (const text of texts[locale]) localeByText[text] ??= locale
}
const generatedSource = `// Generated by scripts/generate-font-morph-data.mjs. Do not edit.\nexport const fontMorphLocaleByText: Readonly<Record<string, string>> = ${JSON.stringify(
  localeByText,
  null,
  2,
)}\n`
await writeFile(resolve(generatedDirectory, 'fontMorphData.ts'), generatedSource)
