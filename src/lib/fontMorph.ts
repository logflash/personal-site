import type { GTReplayerFrame } from 'gt-rrweb/replay'
import type { Font, PathCommand, RenderOptions } from 'opentype.js'

const DEFAULT_DURATION_MS = 760
const DESTINATION_TIMEOUT_MS = 10_000
const MORPH_VIEWBOX_SIZE = 1_000
const MORPH_PRECISION = 8
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const CAPTURE_SELECTOR = '.layout'

type FontRole = 'sans' | 'serif'
type Polygon = [number, number][]
type MorphTextResolver = (
  locale: string | undefined,
  translationHash: string | undefined,
  recordedText: string,
) => string | undefined

interface PointColor {
  red: number
  green: number
  blue: number
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface CaptureFrame {
  screen: Rect
  logicalWidth: number
  logicalHeight: number
}

interface GlyphStyle {
  fontRole: FontRole
  fontFamily: string
  fontStyle: string
  fontWeight: string
  fontSizeToHeight: number
  letterSpacingEm: number
  direction: 'ltr' | 'rtl'
  color: PointColor
}

interface RecordedGlyphEndpoint {
  text: string
  translationHash?: string
  /** Coordinates relative to the capture frame, not the host viewport. */
  rect: Rect
  style: GlyphStyle
}

interface GlyphEndpoint extends RecordedGlyphEndpoint {
  element: HTMLElement
  frame: CaptureFrame
  logicalRect: Rect
}

interface RecordedFontMorph {
  version: 2
  key: string
  /** Time spent showing the stationary source outline before interpolation. */
  leadIn?: number
  duration: number
  /** Replay-only time reserved for reading a visible settled destination. */
  settledTextHold?: number
  source: RecordedGlyphEndpoint
  target: RecordedGlyphEndpoint
}

interface KuteMorphRuntime {
  getInterpolationPoints: (source: string, target: string, precision: number) => [Polygon, Polygon]
  interpolateCoordinates: (
    source: Polygon,
    target: Polygon,
    length: number,
    progress: number,
  ) => Polygon
}

interface OutlineRuntime extends KuteMorphRuntime {
  fonts: Record<FontRole, Font[]>
}

interface OutlineContour {
  path: string
  polygon: Polygon
  depth: number
  center: [number, number]
  area: number
}

interface GlyphOutline {
  contours: OutlineContour[]
}

interface ContourTemplate {
  depth: number
  sourcePath: string
  targetPath: string
  source: Polygon
  target: Polygon
}

interface NormalizedContourTemplate {
  depth: number
  glyphIndex: number
  source: Polygon
  target: Polygon
}

interface NormalizedOutline {
  contours: NormalizedContourTemplate[] | null
  sourceFont?: Font
  targetFont?: Font
  fallback?: string
}

interface ContourMorph extends ContourTemplate {
  element: SVGPathElement
}

interface PreparedOutline {
  contours: ContourTemplate[] | null
  fallback?: string
}

interface PreparedMorph {
  layer: SVGSVGElement
  source: GlyphEndpoint
  target: GlyphEndpoint
  contours: ContourMorph[] | null
}

interface ReplayMorphState {
  event: object
  document: Document
  locale?: string
  layer: SVGSVGElement
  prepared: PreparedMorph
  generation: number
  sawTarget: boolean
  lastTime: number
}

interface ActiveMorph {
  key: string
  source: GlyphEndpoint
  layer: SVGSVGElement
  startedAt: number
  observer: MutationObserver
  timeout: number
  frame: number | null
  finishing: boolean
}

const FONT_FILES: Record<FontRole, readonly string[]> = {
  sans: ['/fonts/ibm-plex-sans-400-outline.ttf', '/fonts/noto-sans-jp-400-outline.ttf'],
  serif: ['/fonts/source-serif-4-600-outline.ttf', '/fonts/noto-serif-jp-600-outline.ttf'],
}

const recordedMorphCache = new WeakMap<GTReplayerFrame['events'], ReturnType<typeof indexMorphs>>()
const replayOutlineCache = new WeakMap<RecordedFontMorph, Map<string, PreparedOutline>>()
const normalizedOutlineCache = new Map<string, NormalizedOutline>()

export const FONT_MORPH_RECORD_EVENT = 'gt-rrweb:font-morph'
export const FONT_MORPH_EVENT_TAG = 'gt-font-morph'
export const SETTLED_TEXT_HOLD_MS = 500

let activeMorph: ActiveMorph | null = null
let outlineRuntimePromise: Promise<OutlineRuntime> | null = null
let loadedOutlineRuntime: OutlineRuntime | null = null
let nextMaskId = 0

function selectorFor(key: string) {
  return `[data-font-morph="${CSS.escape(key)}"]`
}

function findEndpointElement(key: string, except?: HTMLElement, ownerDocument = document) {
  return [...ownerDocument.querySelectorAll<HTMLElement>(selectorFor(key))].find(
    (element) => element !== except && element.isConnected,
  )
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(document: Document, name: K) {
  return document.createElementNS(SVG_NAMESPACE, name)
}

function parseColor(value: string): PointColor {
  const channels = value.match(/[\d.]+/g)?.map(Number)
  return {
    red: channels?.[0] ?? 0,
    green: channels?.[1] ?? 0,
    blue: channels?.[2] ?? 0,
  }
}

function fontRoleFor(fontFamily: string): FontRole {
  return fontFamily.toLowerCase().includes('source serif') ? 'serif' : 'sans'
}

function captureFrame(ownerDocument: Document): CaptureFrame {
  const ownerWindow = ownerDocument.defaultView
  const viewportWidth = Math.max(
    1,
    ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth,
  )
  const viewportHeight = Math.max(
    1,
    ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight,
  )
  const captureElement = ownerDocument.documentElement.classList.contains('gt-recording')
    ? ownerDocument.querySelector<HTMLElement>(CAPTURE_SELECTOR)
    : null

  if (captureElement) {
    const bounds = captureElement.getBoundingClientRect()
    if (bounds.width > 0 && bounds.height > 0) {
      return {
        screen: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        logicalWidth: Math.max(1, captureElement.clientWidth),
        logicalHeight: Math.max(1, captureElement.clientHeight),
      }
    }
  }

  return {
    screen: { left: 0, top: 0, width: viewportWidth, height: viewportHeight },
    logicalWidth: viewportWidth,
    logicalHeight: viewportHeight,
  }
}

function normalizedRect(bounds: DOMRect, frame: CaptureFrame): Rect {
  return {
    left: (bounds.left - frame.screen.left) / frame.screen.width,
    top: (bounds.top - frame.screen.top) / frame.screen.height,
    width: bounds.width / frame.screen.width,
    height: bounds.height / frame.screen.height,
  }
}

function logicalRect(rect: Rect, frame: CaptureFrame): Rect {
  return {
    left: rect.left * frame.logicalWidth,
    top: rect.top * frame.logicalHeight,
    width: rect.width * frame.logicalWidth,
    height: rect.height * frame.logicalHeight,
  }
}

function captureEndpoint(element: HTMLElement): GlyphEndpoint | null {
  const text = element.textContent?.trim()
  const bounds = element.getBoundingClientRect()
  if (!text || bounds.width <= 0 || bounds.height <= 0) return null

  const ownerWindow = element.ownerDocument.defaultView
  const style = ownerWindow?.getComputedStyle(element) ?? getComputedStyle(element)
  const frame = captureFrame(element.ownerDocument)
  const rect = normalizedRect(bounds, frame)
  const logical = logicalRect(rect, frame)
  const fontSize = Number.parseFloat(style.fontSize) || 16
  const letterSpacing = Number.parseFloat(style.letterSpacing)

  return {
    element,
    frame,
    logicalRect: logical,
    text,
    translationHash: element.dataset._gtHash,
    rect,
    style: {
      fontRole: fontRoleFor(style.fontFamily),
      fontFamily: style.fontFamily,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      fontSizeToHeight: fontSize / logical.height,
      letterSpacingEm: Number.isFinite(letterSpacing) ? letterSpacing / fontSize : 0,
      direction: style.direction === 'rtl' ? 'rtl' : 'ltr',
      color: parseColor(style.color),
    },
  }
}

function findMatchingEndpoint(
  ownerDocument: Document,
  key: string,
  expected: RecordedGlyphEndpoint,
  text: string,
  except?: HTMLElement,
) {
  for (const element of ownerDocument.querySelectorAll<HTMLElement>(selectorFor(key))) {
    if (element === except || !element.isConnected) continue
    const endpoint = captureEndpoint(element)
    if (!endpoint || endpoint.style.fontRole !== expected.style.fontRole) continue
    if (endpoint.text !== text) continue
    if (
      expected.translationHash &&
      endpoint.translationHash &&
      endpoint.translationHash !== expected.translationHash
    ) {
      continue
    }
    return endpoint
  }
  return null
}

function endpointFromRecorded(
  recorded: RecordedGlyphEndpoint,
  text: string,
  ownerDocument: Document,
  element: HTMLElement,
  widthRatio = 1,
  frameOverride?: CaptureFrame,
): GlyphEndpoint {
  const frame = frameOverride ?? captureFrame(ownerDocument)
  const rect = { ...recorded.rect, width: recorded.rect.width * widthRatio }
  return {
    ...recorded,
    element,
    frame,
    text,
    rect,
    logicalRect: logicalRect(rect, frame),
  }
}

function recordedEndpoint(endpoint: GlyphEndpoint): RecordedGlyphEndpoint {
  return {
    text: endpoint.text,
    translationHash: endpoint.translationHash,
    rect: endpoint.rect,
    style: endpoint.style,
  }
}

function isInCaptureFrame(rect: Rect) {
  return rect.left + rect.width > 0 && rect.top + rect.height > 0 && rect.left < 1 && rect.top < 1
}

function interpolate(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

function interpolateRect(source: Rect, target: Rect, progress: number): Rect {
  return {
    left: interpolate(source.left, target.left, progress),
    top: interpolate(source.top, target.top, progress),
    width: interpolate(source.width, target.width, progress),
    height: interpolate(source.height, target.height, progress),
  }
}

// The same ease used by the previous native shared-element transition.
function transitionEase(progress: number) {
  const x1 = 0.22
  const y1 = 1
  const x2 = 0.36
  const y2 = 1
  let parameter = progress

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const inverse = 1 - parameter
    const x =
      3 * inverse * inverse * parameter * x1 +
      3 * inverse * parameter * parameter * x2 +
      parameter ** 3
    const slope =
      3 * inverse * inverse * x1 +
      6 * inverse * parameter * (x2 - x1) +
      3 * parameter * parameter * (1 - x2)
    if (Math.abs(slope) < 1e-6) break
    parameter = Math.min(1, Math.max(0, parameter - (x - progress) / slope))
  }

  const inverse = 1 - parameter
  return (
    3 * inverse * inverse * parameter * y1 +
    3 * inverse * parameter * parameter * y2 +
    parameter ** 3
  )
}

function readDuration() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-morph-duration')
    .trim()
  const duration = Number.parseFloat(value)
  if (!Number.isFinite(duration)) return DEFAULT_DURATION_MS
  return value.endsWith('s') && !value.endsWith('ms') ? duration * 1000 : duration
}

function fontSize(endpoint: GlyphEndpoint) {
  return endpoint.style.fontSizeToHeight * endpoint.logicalRect.height
}

function baseline(endpoint: GlyphEndpoint, font?: Font) {
  const size = fontSize(endpoint)
  if (font) {
    const scale = size / font.unitsPerEm
    const ascent = font.ascender * scale
    const descent = Math.abs(font.descender * scale)
    return Math.max(0, endpoint.logicalRect.height - ascent - descent) / 2 + ascent
  }
  return endpoint.logicalRect.height * 0.8
}

function setLayerBox(layer: SVGSVGElement, rect: Rect, ownerDocument: Document) {
  const frame = captureFrame(ownerDocument)
  const screen = {
    left: frame.screen.left + rect.left * frame.screen.width,
    top: frame.screen.top + rect.top * frame.screen.height,
    width: rect.width * frame.screen.width,
    height: rect.height * frame.screen.height,
  }
  layer.style.width = `${screen.width}px`
  layer.style.height = `${screen.height}px`
  layer.style.transform = `translate3d(${screen.left}px, ${screen.top}px, 0)`
}

function setLayerColor(layer: SVGSVGElement, color: PointColor) {
  layer.style.color = `rgb(${Math.round(color.red)} ${Math.round(color.green)} ${Math.round(color.blue)})`
}

function createTextFallback(layer: SVGSVGElement, endpoint: GlyphEndpoint) {
  const text = createSvgElement(layer.ownerDocument, 'text')
  const size = fontSize(endpoint)
  const height = endpoint.logicalRect.height
  const width = endpoint.logicalRect.width
  const viewboxFontSize = (size / height) * MORPH_VIEWBOX_SIZE
  const horizontalCorrection = height / width

  text.textContent = endpoint.text
  text.setAttribute('x', '0')
  text.setAttribute('y', String((baseline(endpoint) / height) * MORPH_VIEWBOX_SIZE))
  text.setAttribute('fill', 'currentColor')
  text.setAttribute('font-family', endpoint.style.fontFamily)
  text.setAttribute('font-size', String(viewboxFontSize))
  text.setAttribute('font-style', endpoint.style.fontStyle)
  text.setAttribute('font-weight', endpoint.style.fontWeight)
  text.setAttribute('letter-spacing', String(endpoint.style.letterSpacingEm * viewboxFontSize))
  text.setAttribute('transform', `scale(${horizontalCorrection} 1)`)
  text.setAttribute('direction', endpoint.style.direction)
  layer.replaceChildren(text)
}

function createInitialLayer(endpoint: GlyphEndpoint, replay = false) {
  const layer = createSvgElement(endpoint.element.ownerDocument, 'svg')
  layer.classList.add(replay ? 'font-morph-director-layer' : 'font-morph-layer')
  if (!replay) layer.classList.add('rr-block')
  layer.setAttribute('viewBox', `0 0 ${MORPH_VIEWBOX_SIZE} ${MORPH_VIEWBOX_SIZE}`)
  layer.setAttribute('preserveAspectRatio', 'none')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText +=
    'position:fixed;inset:0 auto auto 0;z-index:2147483646;display:block;overflow:visible;pointer-events:none;transform-origin:top left;'
  createTextFallback(layer, endpoint)
  setLayerBox(layer, endpoint.rect, endpoint.element.ownerDocument)
  setLayerColor(layer, endpoint.style.color)
  endpoint.element.ownerDocument.body.append(layer)
  return layer
}

function renderOptions(): RenderOptions {
  return {
    kerning: true,
    letterSpacing: 0,
    features: { liga: false, rlig: false },
  }
}

function commandNumber(value: number) {
  return Number(value.toFixed(3))
}

function contourPath(commands: PathCommand[]) {
  return commands
    .map((command) => {
      switch (command.type) {
        case 'M':
        case 'L':
          return `${command.type}${commandNumber(command.x)} ${commandNumber(command.y)}`
        case 'C':
          return `C${commandNumber(command.x1)} ${commandNumber(command.y1)} ${commandNumber(command.x2)} ${commandNumber(command.y2)} ${commandNumber(command.x)} ${commandNumber(command.y)}`
        case 'Q':
          return `Q${commandNumber(command.x1)} ${commandNumber(command.y1)} ${commandNumber(command.x)} ${commandNumber(command.y)}`
        case 'Z':
          return 'Z'
      }
    })
    .join('')
}

function splitContours(commands: PathCommand[]) {
  const contours: PathCommand[][] = []
  let current: PathCommand[] = []
  for (const command of commands) {
    if (command.type === 'M' && current.length) {
      contours.push(current)
      current = []
    }
    current.push(command)
    if (command.type === 'Z') {
      contours.push(current)
      current = []
    }
  }
  if (current.length) contours.push(current)
  return contours.filter((contour) => contour.some((command) => command.type !== 'M'))
}

function pointInPolygon(point: [number, number], polygon: Polygon) {
  let inside = false
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const [currentX, currentY] = polygon[current]
    const [previousX, previousY] = polygon[previous]
    const crosses =
      currentY > point[1] !== previousY > point[1] &&
      point[0] <
        ((previousX - currentX) * (point[1] - currentY)) / (previousY - currentY) + currentX
    if (crosses) inside = !inside
  }
  return inside
}

function polygonStats(polygon: Polygon) {
  let doubledArea = 0
  let centerX = 0
  let centerY = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    const cross = current[0] * next[1] - next[0] * current[1]
    doubledArea += cross
    centerX += (current[0] + next[0]) * cross
    centerY += (current[1] + next[1]) * cross
  }
  const area = Math.abs(doubledArea) / 2
  if (Math.abs(doubledArea) < 1e-6) {
    const sum = polygon.reduce(
      (result, point) => [result[0] + point[0], result[1] + point[1]] as [number, number],
      [0, 0] as [number, number],
    )
    return {
      area,
      center: [sum[0] / polygon.length, sum[1] / polygon.length] as [number, number],
    }
  }
  return {
    area,
    center: [centerX / (3 * doubledArea), centerY / (3 * doubledArea)] as [number, number],
  }
}

function classifyContours(paths: string[], runtime: KuteMorphRuntime): OutlineContour[] {
  const contours = paths.map((path) => {
    const polygon = runtime.getInterpolationPoints(path, path, MORPH_PRECISION)[0]
    const { area, center } = polygonStats(polygon)
    return { path, polygon, depth: 0, center, area }
  })

  for (const contour of contours) {
    const sample = contour.polygon[0]
    contour.depth = contours.reduce(
      (depth, candidate) =>
        candidate !== contour && pointInPolygon(sample, candidate.polygon) ? depth + 1 : depth,
      0,
    )
  }
  return contours
}

function outlineFont(text: string, fonts: readonly Font[]) {
  const characters = [...text]
  return fonts.find((candidate) => characters.every((character) => candidate.hasChar(character)))
}

function buildOutline(text: string, font: Font, runtime: KuteMorphRuntime): GlyphOutline[] {
  // Build once in a common 1,000-unit em square. Endpoint size, line box, and
  // letter spacing are cheap affine transforms applied only after navigation
  // reveals the target.
  const canonicalBaseline = (font.ascender / font.unitsPerEm) * MORPH_VIEWBOX_SIZE
  const paths = font.getPaths(text, 0, canonicalBaseline, MORPH_VIEWBOX_SIZE, renderOptions())
  return paths.map((path) => {
    const contours = splitContours(path.commands).map((commands) => contourPath(commands))
    return { contours: classifyContours(contours, runtime) }
  })
}

function contourPairCost(source: OutlineContour, target: OutlineContour) {
  const centerDistance = Math.hypot(
    source.center[0] - target.center[0],
    source.center[1] - target.center[1],
  )
  const areaDistance = Math.abs(Math.log((source.area + 1) / (target.area + 1))) * 100
  return centerDistance + areaDistance
}

function pairGlyphContours(source: GlyphOutline, target: GlyphOutline) {
  const pairs: [OutlineContour, OutlineContour][] = []
  const depths = new Set([
    ...source.contours.map((contour) => contour.depth),
    ...target.contours.map((contour) => contour.depth),
  ])

  for (const depth of depths) {
    const sourceAtDepth = source.contours.filter((contour) => contour.depth === depth)
    const availableTargets = target.contours.filter((contour) => contour.depth === depth)

    // CJK sans/serif masters can decompose the same visible shape into a
    // different number of filled contours and counters. Give every unmatched
    // contour an epsilon-sized counterpart instead of creating/removing a path
    // during interpolation. In particular, the mask contains a stable number
    // of counter paths for the entire transition.

    for (const sourceContour of sourceAtDepth) {
      if (!availableTargets.length) {
        pairs.push([sourceContour, collapsedContour(sourceContour)])
        continue
      }
      let bestIndex = 0
      for (let index = 1; index < availableTargets.length; index += 1) {
        if (
          contourPairCost(sourceContour, availableTargets[index]) <
          contourPairCost(sourceContour, availableTargets[bestIndex])
        ) {
          bestIndex = index
        }
      }
      const [targetContour] = availableTargets.splice(bestIndex, 1)
      pairs.push([sourceContour, targetContour])
    }
    for (const targetContour of availableTargets) {
      pairs.push([collapsedContour(targetContour), targetContour])
    }
  }
  return pairs
}

function collapsedContour(contour: OutlineContour): OutlineContour {
  const [x, y] = contour.center
  const radius = 0.001
  const polygon: Polygon = [
    [x - radius, y],
    [x, y - radius],
    [x + radius, y],
    [x, y + radius],
  ]
  return {
    path: polygonPath(polygon),
    polygon,
    depth: contour.depth,
    center: contour.center,
    area: 0,
  }
}

async function loadOutlineRuntime() {
  if (!outlineRuntimePromise) {
    outlineRuntimePromise = Promise.all([
      import('opentype.js'),
      import('kute.js/src/components/svgMorph'),
      Promise.all(
        Object.entries(FONT_FILES).map(async ([role, urls]) => {
          const buffers = await Promise.all(
            urls.map(async (url) => {
              const response = await fetch(url)
              if (!response.ok) {
                throw new Error(`Unable to load font outlines: ${response.status}`)
              }
              return response.arrayBuffer()
            }),
          )
          return [role as FontRole, buffers] as const
        }),
      ),
    ])
      .then(([opentype, kuteSvgMorph, fontBuffers]) => {
        const component = kuteSvgMorph.default
        loadedOutlineRuntime = {
          fonts: Object.fromEntries(
            fontBuffers.map(([role, buffers]) => [
              role,
              buffers.map((buffer) => opentype.parse(buffer)),
            ]),
          ) as Record<FontRole, Font[]>,
          getInterpolationPoints: component.Util.getInterpolationPoints,
          interpolateCoordinates: component.Interpolate,
        }
        return loadedOutlineRuntime
      })
      .catch((error: unknown) => {
        // A transient chunk/font failure must not poison every later morph in
        // this tab. The next pointer hover gets a fresh request.
        outlineRuntimePromise = null
        throw error
      })
  }
  return outlineRuntimePromise
}

function normalizedOutline(
  text: string,
  sourceRole: FontRole,
  targetRole: FontRole,
  runtime: OutlineRuntime,
): NormalizedOutline {
  const cacheKey = JSON.stringify([text, sourceRole, targetRole])
  const cached = normalizedOutlineCache.get(cacheKey)
  if (cached) return cached

  const reverseKey = JSON.stringify([text, targetRole, sourceRole])
  const reverse = normalizedOutlineCache.get(reverseKey)
  if (reverse?.contours && reverse.sourceFont && reverse.targetFont) {
    const normalized: NormalizedOutline = {
      sourceFont: reverse.targetFont,
      targetFont: reverse.sourceFont,
      contours: reverse.contours.map((contour) => ({
        depth: contour.depth,
        glyphIndex: contour.glyphIndex,
        source: contour.target,
        target: contour.source,
      })),
    }
    normalizedOutlineCache.set(cacheKey, normalized)
    return normalized
  }

  const sourceFont = outlineFont(text, runtime.fonts[sourceRole])
  const targetFont = outlineFont(text, runtime.fonts[targetRole])
  if (!sourceFont || !targetFont) {
    const normalized: NormalizedOutline = {
      contours: null,
      fallback: 'unsupported-glyph',
    }
    normalizedOutlineCache.set(cacheKey, normalized)
    return normalized
  }

  const sourceGlyphs = buildOutline(text, sourceFont, runtime)
  const targetGlyphs = buildOutline(text, targetFont, runtime)
  if (sourceGlyphs.length !== targetGlyphs.length) {
    const normalized: NormalizedOutline = {
      contours: null,
      sourceFont,
      targetFont,
      fallback: 'glyph-count',
    }
    normalizedOutlineCache.set(cacheKey, normalized)
    return normalized
  }

  const contours: NormalizedContourTemplate[] = []
  for (let glyphIndex = 0; glyphIndex < sourceGlyphs.length; glyphIndex += 1) {
    for (const [sourceContour, targetContour] of pairGlyphContours(
      sourceGlyphs[glyphIndex],
      targetGlyphs[glyphIndex],
    )) {
      // This is KUTE's expensive topology normalization and point matching.
      // It deliberately happens in canonical font space so it can be cached
      // before navigation, independently of the destination viewport/layout.
      const [sourcePoints, targetPoints] = runtime.getInterpolationPoints(
        sourceContour.path,
        targetContour.path,
        MORPH_PRECISION,
      )
      contours.push({
        depth: sourceContour.depth,
        glyphIndex,
        source: sourcePoints,
        target: targetPoints,
      })
    }
  }
  contours.sort((a, b) => a.depth - b.depth)

  const normalized = { contours, sourceFont, targetFont }
  normalizedOutlineCache.set(cacheKey, normalized)
  return normalized
}

function materializePolygon(
  polygon: Polygon,
  endpoint: GlyphEndpoint,
  font: Font,
  glyphIndex: number,
): Polygon {
  const size = fontSize(endpoint)
  const scale = size / MORPH_VIEWBOX_SIZE
  const canonicalBaseline = (font.ascender / font.unitsPerEm) * MORPH_VIEWBOX_SIZE
  const letterSpacing = glyphIndex * endpoint.style.letterSpacingEm * size
  const width = Math.max(Number.EPSILON, endpoint.logicalRect.width)
  const height = Math.max(Number.EPSILON, endpoint.logicalRect.height)

  return polygon.map(([x, y]) => [
    commandNumber(((x * scale + letterSpacing) / width) * MORPH_VIEWBOX_SIZE),
    commandNumber(
      ((baseline(endpoint, font) + (y - canonicalBaseline) * scale) / height) * MORPH_VIEWBOX_SIZE,
    ),
  ])
}

function prepareOutline(
  source: GlyphEndpoint,
  target: GlyphEndpoint,
  runtime: OutlineRuntime,
): PreparedOutline {
  const normalized = normalizedOutline(
    source.text,
    source.style.fontRole,
    target.style.fontRole,
    runtime,
  )
  if (!normalized.contours || !normalized.sourceFont || !normalized.targetFont) {
    return { contours: null, fallback: normalized.fallback }
  }

  return {
    contours: normalized.contours.map((contour) => {
      const sourcePoints = materializePolygon(
        contour.source,
        source,
        normalized.sourceFont!,
        contour.glyphIndex,
      )
      const targetPoints = materializePolygon(
        contour.target,
        target,
        normalized.targetFont!,
        contour.glyphIndex,
      )
      return {
        depth: contour.depth,
        sourcePath: polygonPath(sourcePoints),
        targetPath: polygonPath(targetPoints),
        source: sourcePoints,
        target: targetPoints,
      }
    }),
  }
}

/**
 * Warm the lazy vector runtime and, when an endpoint is mounted, precompute
 * KUTE's viewport-independent contour correspondence before interaction.
 */
export function prepareFontMorph(key?: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const endpoint = key ? findEndpointElement(key) : undefined
  const captured = endpoint ? captureEndpoint(endpoint) : null
  return loadOutlineRuntime().then((runtime) => {
    if (!captured) return
    const targetRole: FontRole = captured.style.fontRole === 'sans' ? 'serif' : 'sans'
    normalizedOutline(captured.text, captured.style.fontRole, targetRole, runtime)
  })
}

function mountPreparedOutline(
  layer: SVGSVGElement,
  source: GlyphEndpoint,
  target: GlyphEndpoint,
  prepared: PreparedOutline,
): PreparedMorph {
  if (!prepared.contours) {
    layer.dataset.fontMorphFallback = prepared.fallback ?? 'unavailable'
    return { layer, source, target, contours: null }
  }

  const maskId = `font-morph-mask-${++nextMaskId}`
  const definitions = createSvgElement(layer.ownerDocument, 'defs')
  const mask = createSvgElement(layer.ownerDocument, 'mask')
  mask.id = maskId
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('x', '0')
  mask.setAttribute('y', '0')
  mask.setAttribute('width', String(MORPH_VIEWBOX_SIZE))
  mask.setAttribute('height', String(MORPH_VIEWBOX_SIZE))
  mask.style.maskType = 'luminance'

  const contours = prepared.contours.map((contour) => {
    const path = createSvgElement(layer.ownerDocument, 'path')
    path.setAttribute('d', contour.sourcePath)
    path.setAttribute('fill', contour.depth % 2 === 0 ? 'white' : 'black')
    mask.append(path)
    return { ...contour, element: path }
  })

  const fill = createSvgElement(layer.ownerDocument, 'rect')
  fill.setAttribute('width', String(MORPH_VIEWBOX_SIZE))
  fill.setAttribute('height', String(MORPH_VIEWBOX_SIZE))
  fill.setAttribute('fill', 'currentColor')
  fill.setAttribute('mask', `url(#${maskId})`)
  definitions.append(mask)
  layer.replaceChildren(definitions, fill)
  return { layer, source, target, contours }
}

function prepareOutlineMorph(
  layer: SVGSVGElement,
  source: GlyphEndpoint,
  target: GlyphEndpoint,
  runtime: OutlineRuntime,
) {
  return mountPreparedOutline(layer, source, target, prepareOutline(source, target, runtime))
}

function polygonPath(points: Polygon) {
  return `M${points.map((point) => `${point[0]},${point[1]}`).join('L')}Z`
}

function paintPreparedMorph(
  prepared: PreparedMorph,
  geometryProgress: number,
  outlineProgress: number,
  runtime?: KuteMorphRuntime,
) {
  const { layer, source, target, contours } = prepared
  setLayerBox(
    layer,
    interpolateRect(source.rect, target.rect, geometryProgress),
    layer.ownerDocument,
  )
  setLayerColor(layer, {
    red: interpolate(source.style.color.red, target.style.color.red, outlineProgress),
    green: interpolate(source.style.color.green, target.style.color.green, outlineProgress),
    blue: interpolate(source.style.color.blue, target.style.color.blue, outlineProgress),
  })

  if (!contours || !runtime) return
  for (const contour of contours) {
    if (outlineProgress === 0) {
      contour.element.setAttribute('d', contour.sourcePath)
    } else if (outlineProgress === 1) {
      contour.element.setAttribute('d', contour.targetPath)
    } else {
      contour.element.setAttribute(
        'd',
        polygonPath(
          runtime.interpolateCoordinates(
            contour.source,
            contour.target,
            contour.target.length,
            outlineProgress,
          ),
        ),
      )
    }
  }
}

function emitRecordedMorph(
  key: string,
  leadIn: number,
  duration: number,
  source: GlyphEndpoint,
  target: GlyphEndpoint,
) {
  source.element.ownerDocument.defaultView?.dispatchEvent(
    new CustomEvent<RecordedFontMorph>(FONT_MORPH_RECORD_EVENT, {
      detail: {
        version: 2,
        key,
        leadIn,
        duration,
        settledTextHold: SETTLED_TEXT_HOLD_MS,
        source: recordedEndpoint(source),
        target: recordedEndpoint(target),
      },
    }),
  )
}

function cleanup(morph: ActiveMorph) {
  if (activeMorph !== morph) return
  morph.observer.disconnect()
  window.clearTimeout(morph.timeout)
  if (morph.frame !== null) cancelAnimationFrame(morph.frame)
  morph.layer.remove()
  document.documentElement.removeAttribute('data-font-morph-active')
  activeMorph = null
}

function waitForLayout() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function animateTo(morph: ActiveMorph, targetElement: HTMLElement) {
  if (morph.finishing || activeMorph !== morph) return
  morph.finishing = true

  await waitForLayout()
  if (activeMorph !== morph || !targetElement.isConnected) {
    cleanup(morph)
    return
  }

  const provisionalTarget = captureEndpoint(targetElement)
  if (!provisionalTarget) {
    cleanup(morph)
    return
  }

  if ('fonts' in document) {
    try {
      const size = fontSize(provisionalTarget)
      const font = `${provisionalTarget.style.fontStyle} ${provisionalTarget.style.fontWeight} ${size}px ${provisionalTarget.style.fontFamily}`
      // CSS faces are requested during initial page load. Avoid paying another
      // pair of layout frames when the exact destination face is already
      // ready; only a genuine cache miss needs the asynchronous font gate.
      if (!document.fonts.check(font, provisionalTarget.text)) {
        await document.fonts.load(font, provisionalTarget.text)
        await waitForLayout()
      }
    } catch {
      // The outline renderer uses the self-hosted face even if a platform
      // fallback rejects an explicit FontFaceSet load.
    }
  }
  if (activeMorph !== morph || !targetElement.isConnected) {
    cleanup(morph)
    return
  }

  const target = captureEndpoint(targetElement)
  if (!target || !isInCaptureFrame(target.rect)) {
    cleanup(morph)
    return
  }

  let runtime: OutlineRuntime | undefined
  let prepared: PreparedMorph = { layer: morph.layer, source: morph.source, target, contours: null }
  try {
    runtime = await loadOutlineRuntime()
    if (activeMorph !== morph) return
    prepared = prepareOutlineMorph(morph.layer, morph.source, target, runtime)
  } catch (error) {
    console.error('Unable to prepare SVG font outlines', error)
    cleanup(morph)
    return
  }
  if (activeMorph !== morph) return
  // Do not imitate a font morph by merely moving live sans-serif text. If a
  // glyph's topology cannot be paired safely, reveal the destination now.
  if (!prepared.contours) {
    cleanup(morph)
    return
  }

  const duration = Math.max(1, readDuration())
  emitRecordedMorph(
    morph.key,
    Math.max(0, performance.now() - morph.startedAt),
    duration,
    morph.source,
    target,
  )
  const startedAt = performance.now()

  const paint = (time: number) => {
    if (activeMorph !== morph) return
    const linearProgress = Math.min(1, (time - startedAt) / duration)
    const geometryProgress = transitionEase(linearProgress)
    const currentTarget = findMatchingEndpoint(
      morph.layer.ownerDocument,
      morph.key,
      target,
      target.text,
      morph.source.element,
    )
    // Navigation, active-navbar styling, resizing, orientation changes, and
    // scrolling can all reflow the destination while the outline is moving.
    // Follow the semantic endpoint itself instead of freezing its first pixel
    // box. If that endpoint leaves the capture frame (or is replaced by a
    // different locale/message), settle on the real post-navigation DOM.
    if (currentTarget) prepared.target = currentTarget
    const currentRect = interpolateRect(morph.source.rect, prepared.target.rect, geometryProgress)
    if (!currentTarget && !isInCaptureFrame(currentRect)) {
      cleanup(morph)
      return
    }
    if (currentTarget && !isInCaptureFrame(currentTarget.rect) && !isInCaptureFrame(currentRect)) {
      cleanup(morph)
      return
    }
    // Position/size retain the shared-element ease, but KUTE's contour and
    // color interpolation stay linear so the serifs develop throughout the
    // full transition instead of being compressed into one part of it.
    paintPreparedMorph(prepared, geometryProgress, linearProgress, runtime)

    if (linearProgress < 1) {
      morph.frame = requestAnimationFrame(paint)
    } else {
      cleanup(morph)
    }
  }

  morph.frame = requestAnimationFrame(paint)
}

function recordedActivationTimestamp(
  events: GTReplayerFrame['events'],
  eventIndex: number,
  payload: RecordedFontMorph,
) {
  for (let index = eventIndex - 1; index >= 0; index -= 1) {
    const candidate = events[index] as (typeof events)[number] & {
      data?: {
        source?: number
        attributes?: { attributes?: Record<string, string | null> }[]
      }
    }
    if (
      candidate.type === 3 &&
      candidate.data?.source === 0 &&
      candidate.data.attributes?.some(
        (change) => change.attributes?.['data-font-morph-active'] === payload.key,
      )
    ) {
      return candidate.timestamp
    }
  }

  return events[eventIndex].timestamp - Math.max(0, payload.leadIn ?? 0)
}

function indexMorphs(events: GTReplayerFrame['events']) {
  return events.flatMap((event, eventIndex) => {
    const customEvent = event as typeof event & {
      data?: { tag?: string; payload?: RecordedFontMorph }
    }
    const payload = customEvent.data?.payload
    return customEvent.type === 5 &&
      customEvent.data?.tag === FONT_MORPH_EVENT_TAG &&
      payload?.version === 2 &&
      payload.duration > 0
      ? [
          {
            event: customEvent,
            payload,
            activationTimestamp: recordedActivationTimestamp(events, eventIndex, payload),
          },
        ]
      : []
  })
}

function settledTextHold(payload: RecordedFontMorph) {
  return Number.isFinite(payload.settledTextHold) && (payload.settledTextHold ?? -1) >= 0
    ? payload.settledTextHold!
    : SETTLED_TEXT_HOLD_MS
}

/**
 * Adds the director's replay hold to recordings made before the field was
 * embedded in font-morph events. gt-rrweb reads this value while constructing
 * its deterministic timeline; the frame director later skips the reservation
 * when the translated destination is not visible.
 */
export function reserveFontMorphSettledTextHolds(events: GTReplayerFrame['events']) {
  let changed = false
  const prepared = events.map((event) => {
    const customEvent = event as typeof event & {
      data?: { tag?: string; payload?: RecordedFontMorph }
    }
    const payload = customEvent.data?.payload
    if (
      customEvent.type !== 5 ||
      customEvent.data?.tag !== FONT_MORPH_EVENT_TAG ||
      payload?.version !== 2 ||
      (Number.isFinite(payload.settledTextHold) && (payload.settledTextHold ?? -1) >= 0)
    ) {
      return event
    }
    changed = true
    return {
      ...customEvent,
      data: {
        ...customEvent.data,
        payload: { ...payload, settledTextHold: SETTLED_TEXT_HOLD_MS },
      },
    } as typeof event
  })
  return changed ? prepared : events
}

function recordedMorphAt(frame: GTReplayerFrame) {
  const firstTimestamp = frame.events[0]?.timestamp ?? 0
  let morphs = recordedMorphCache.get(frame.events)
  if (!morphs) {
    morphs = indexMorphs(frame.events)
    recordedMorphCache.set(frame.events, morphs)
  }
  for (let index = morphs.length - 1; index >= 0; index -= 1) {
    const { event, payload, activationTimestamp } = morphs[index]
    const activationStart = activationTimestamp - firstTimestamp
    const start = event.timestamp - firstTimestamp
    const end = start + payload.duration
    const holdEnd = end + settledTextHold(payload)
    if (frame.time >= activationStart && frame.time < holdEnd) {
      return { event, payload, activationStart, start, end, holdEnd }
    }
  }
  return null
}

function measureAdvance(recorded: RecordedGlyphEndpoint, text: string, ownerDocument: Document) {
  const canvas = ownerDocument.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return recorded.rect.width
  const size = 100
  context.font = `${recorded.style.fontStyle} ${recorded.style.fontWeight} ${size}px ${recorded.style.fontFamily}`
  context.direction = recorded.style.direction
  const spacing = recorded.style.letterSpacingEm * size
  return context.measureText(text).width + Math.max(0, [...text].length - 1) * spacing
}

function translatedEndpoint(
  recorded: RecordedGlyphEndpoint,
  translatedText: string,
  ownerDocument: Document,
  targetElement: HTMLElement,
  frameOverride?: CaptureFrame,
) {
  const recordedAdvance = measureAdvance(recorded, recorded.text, ownerDocument)
  const translatedAdvance = measureAdvance(recorded, translatedText, ownerDocument)
  const ratio = recordedAdvance > 0 ? translatedAdvance / recordedAdvance : 1
  return endpointFromRecorded(
    recorded,
    translatedText,
    ownerDocument,
    targetElement,
    ratio,
    frameOverride,
  )
}

function recordedCaptureRatio(events: GTReplayerFrame['events']) {
  type SerializedNode = {
    tagName?: string
    attributes?: Record<string, string>
    childNodes?: SerializedNode[]
  }
  const visit = (node: SerializedNode | undefined): number | undefined => {
    if (!node) return undefined
    if (node.tagName === 'html') {
      const match = node.attributes?.style?.match(/--gt-capture-height-ratio:\s*([\d.]+)/)
      const ratio = Number.parseFloat(match?.[1] ?? '')
      if (Number.isFinite(ratio) && ratio > 0) return ratio
    }
    for (const child of node.childNodes ?? []) {
      const ratio = visit(child)
      if (ratio) return ratio
    }
    return undefined
  }

  for (const event of events) {
    if (event.type === 2) {
      const ratio = visit((event.data as { node?: SerializedNode }).node)
      if (ratio) return ratio
    }
  }
  const meta = events.find((event) => event.type === 4)?.data as
    | { width?: number; height?: number }
    | undefined
  return meta?.width && meta.height ? meta.height / meta.width : 1
}

function replayText(
  payload: RecordedFontMorph,
  locale: string | undefined,
  resolveText?: MorphTextResolver,
) {
  const translationHash = payload.source.translationHash ?? payload.target.translationHash
  return resolveText?.(locale, translationHash, payload.source.text) ?? payload.source.text
}

/**
 * Computes KUTE's expensive point correspondence before GTReplayer starts its
 * wall clock. Cached templates contain no DOM nodes and can therefore be
 * mounted into the replay iframe synchronously on their first visible frame.
 */
export async function prepareFontMorphReplay(
  events: GTReplayerFrame['events'],
  locales: readonly (string | undefined)[],
  resolveText: MorphTextResolver,
  ownerDocument: Document,
) {
  const runtime = await loadOutlineRuntime()
  const ratio = recordedCaptureRatio(events)
  const frame: CaptureFrame = {
    screen: { left: 0, top: 0, width: 1_000, height: 1_000 * ratio },
    logicalWidth: 1_000,
    logicalHeight: 1_000 * ratio,
  }
  const endpointElement = ownerDocument.documentElement
  const preparedByDirection = new Map<string, PreparedOutline>()
  const endpointKey = (endpoint: GlyphEndpoint) =>
    JSON.stringify({ text: endpoint.text, rect: endpoint.rect, style: endpoint.style })
  const reverseOutline = (prepared: PreparedOutline): PreparedOutline => ({
    fallback: prepared.fallback,
    contours:
      prepared.contours?.map((contour) => ({
        ...contour,
        sourcePath: contour.targetPath,
        targetPath: contour.sourcePath,
        source: contour.target,
        target: contour.source,
      })) ?? null,
  })

  for (const { payload } of indexMorphs(events)) {
    let localeCache = replayOutlineCache.get(payload)
    if (!localeCache) {
      localeCache = new Map()
      replayOutlineCache.set(payload, localeCache)
    }
    for (const locale of locales) {
      const cacheKey = locale ?? ''
      if (localeCache.has(cacheKey)) continue
      const translatedText = replayText(payload, locale, resolveText)
      const source = translatedEndpoint(
        payload.source,
        translatedText,
        ownerDocument,
        endpointElement,
        frame,
      )
      const target = translatedEndpoint(
        payload.target,
        translatedText,
        ownerDocument,
        endpointElement,
        frame,
      )
      const sourceKey = endpointKey(source)
      const targetKey = endpointKey(target)
      const directionKey = `${sourceKey}>${targetKey}`
      const reverseDirectionKey = `${targetKey}>${sourceKey}`
      let prepared = preparedByDirection.get(directionKey)
      if (!prepared) {
        const reverse = preparedByDirection.get(reverseDirectionKey)
        prepared = reverse ? reverseOutline(reverse) : prepareOutline(source, target, runtime)
        preparedByDirection.set(directionKey, prepared)
      }
      localeCache.set(cacheKey, prepared)
    }
  }
}

/**
 * Deterministic gt-rrweb director. KUTE prepares the corresponding contour
 * samples, while every rendered path derives from absolute replay time. That
 * makes seeking and rewinding video-like instead of carrying tween state.
 */
export function createFontMorphReplayDirector(resolveText?: MorphTextResolver) {
  let state: ReplayMorphState | null = null
  let generation = 0
  let runtime: OutlineRuntime | undefined

  const clear = () => {
    generation += 1
    state?.document.documentElement.removeAttribute('data-font-morph-fallback')
    state?.layer.remove()
    state = null
  }

  return (frame: GTReplayerFrame) => {
    if (!frame.document) {
      clear()
      return
    }

    // A seek/rewind must rebuild transient state from replay time. In
    // particular, whether a destination has appeared may never leak backward.
    if (state && frame.time < state.lastTime) clear()

    const active = recordedMorphAt(frame)
    if (!active) {
      clear()
      // rrweb can retain the recorded hiding attribute for a few milliseconds
      // between adjacent morphs. Never expose that bookkeeping as a blank gap.
      if (frame.document.documentElement.hasAttribute('data-font-morph-active')) {
        frame.document.documentElement.dataset.fontMorphFallback = ''
      }
      return
    }

    // The deterministic replay timeline reserves a reading hold after the
    // outline reaches its destination. Reveal the real translated DOM during
    // that interval. Visibility belongs to the director because locale text,
    // layout, scrolling, and viewport changes can all alter the answer.
    if (frame.time >= active.end) {
      clear()
      const translatedText = replayText(active.payload, frame.locale, resolveText)
      const currentTarget = findMatchingEndpoint(
        frame.document,
        active.payload.key,
        active.payload.target,
        translatedText,
      )
      frame.document.documentElement.dataset.fontMorphFallback = ''
      if (!currentTarget || !isInCaptureFrame(currentTarget.rect)) {
        return { advanceTo: active.holdEnd }
      }
      return
    }

    // A locale swap changes both glyph outlines and layout. Treat it as a
    // semantic cut to the already-mounted destination in the requested
    // locale instead of leaving a frame where the old and new layers cross.
    if (
      state &&
      state.event === active.event &&
      state.document === frame.document &&
      state.locale !== frame.locale
    ) {
      clear()
      frame.document.documentElement.dataset.fontMorphFallback = ''
      return { advanceTo: active.end }
    }

    if (
      !state ||
      state.event !== active.event ||
      state.document !== frame.document ||
      state.locale !== frame.locale ||
      !state.layer.isConnected
    ) {
      clear()
      const translatedText = replayText(active.payload, frame.locale, resolveText)
      const endpointElement = frame.document.documentElement
      // Endpoint geometry comes from the semantic event, not whichever route
      // happens to be mounted on this frame. This lets the director render the
      // stationary source immediately, before the destination DOM is committed.
      const source = translatedEndpoint(
        active.payload.source,
        translatedText,
        frame.document,
        endpointElement,
      )
      const target = translatedEndpoint(
        active.payload.target,
        translatedText,
        frame.document,
        endpointElement,
      )
      const layer = createInitialLayer(source, true)
      const currentGeneration = generation
      state = {
        event: active.event,
        document: frame.document,
        locale: frame.locale,
        layer,
        prepared: { layer, source, target, contours: null },
        generation: currentGeneration,
        sawTarget: false,
        lastTime: frame.time,
      }

      const settleWithoutMorph = () => {
        layer.replaceChildren()
        layer.style.display = 'none'
        layer.ownerDocument.documentElement.dataset.fontMorphFallback = ''
      }
      const installRuntime = (availableRuntime: OutlineRuntime) => {
        if (!state || state.generation !== currentGeneration || !layer.isConnected) return
        runtime = availableRuntime
        const cachedOutline = replayOutlineCache.get(active.payload)?.get(frame.locale ?? '')
        state.prepared = cachedOutline
          ? mountPreparedOutline(layer, source, target, cachedOutline)
          : prepareOutlineMorph(layer, source, target, availableRuntime)
        if (!state.prepared.contours) settleWithoutMorph()
      }

      if (loadedOutlineRuntime) {
        // ReplayOverlay preloads this runtime before mounting GTReplayer, so
        // the very first visible transition frame already contains contours.
        installRuntime(loadedOutlineRuntime)
      } else {
        void loadOutlineRuntime()
          .then(installRuntime)
          .catch((error: unknown) => {
            console.error('Unable to prepare replay SVG font outlines', error)
            settleWithoutMorph()
          })
      }
    }

    state.lastTime = frame.time
    const translatedText = replayText(active.payload, frame.locale, resolveText)
    const currentTarget = findMatchingEndpoint(
      frame.document,
      active.payload.key,
      active.payload.target,
      translatedText,
    )
    if (currentTarget) {
      state.sawTarget = true
      state.prepared.target = currentTarget
    }
    const linearProgress = Math.min(
      1,
      Math.max(0, (frame.time - active.start) / active.payload.duration),
    )
    const geometryProgress = transitionEase(linearProgress)
    const currentRect = interpolateRect(
      state.prepared.source.rect,
      state.prepared.target.rect,
      geometryProgress,
    )
    if (
      (!currentTarget && state.sawTarget && !isInCaptureFrame(currentRect)) ||
      (currentTarget && !isInCaptureFrame(currentTarget.rect) && !isInCaptureFrame(currentRect))
    ) {
      state.layer.style.display = 'none'
      frame.document.documentElement.dataset.fontMorphFallback = ''
      return { advanceTo: active.holdEnd }
    }
    state.layer.style.display = 'block'
    frame.document.documentElement.removeAttribute('data-font-morph-fallback')

    if (!runtime || !state.prepared.contours) {
      // Keep the source outline stationary during its recorded lead-in. Never
      // scale fallback text and replace it with contours halfway through.
      setLayerBox(state.layer, state.prepared.source.rect, frame.document)
      return
    }
    paintPreparedMorph(state.prepared, geometryProgress, linearProgress, runtime)
  }
}

/**
 * Captures the currently mounted endpoint and waits for navigation to mount
 * another element with the same key. The recorded geometry is relative to the
 * gt-rrweb capture frame; SVG viewBox coordinates contain no viewport pixels.
 */
export function beginFontMorph(key: string) {
  if (
    typeof document === 'undefined' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return false
  }

  if (activeMorph) cleanup(activeMorph)
  const sourceElement = findEndpointElement(key)
  if (!sourceElement) return false
  const source = captureEndpoint(sourceElement)
  if (!source || !isInCaptureFrame(source.rect)) return false
  const layer = createInitialLayer(source)

  const observer = new MutationObserver(() => {
    const destination = findEndpointElement(key, sourceElement)
    if (destination) void animateTo(morph, destination)
  })
  const morph: ActiveMorph = {
    key,
    source,
    layer,
    startedAt: performance.now(),
    observer,
    timeout: 0,
    frame: null,
    finishing: false,
  }
  activeMorph = morph
  document.documentElement.dataset.fontMorphActive = key
  observer.observe(document.body, { childList: true, subtree: true })
  morph.timeout = window.setTimeout(() => cleanup(morph), DESTINATION_TIMEOUT_MS)
  void prepareFontMorph(key).catch(() => undefined)

  // Some routers reuse the surrounding DOM and commit before a mutation
  // observer gets its turn. The next frame catches that case.
  requestAnimationFrame(() => {
    const destination = findEndpointElement(key, sourceElement)
    if (destination) void animateTo(morph, destination)
  })
  return true
}
