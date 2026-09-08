/// <reference path="./kute.d.ts" />

import type { Font, PathCommand, RenderOptions } from 'opentype.js'

const DEFAULT_DURATION_MS = 1_520
const DESTINATION_TIMEOUT_MS = 10_000
const MORPH_VIEWBOX_SIZE = 1_000
const MORPH_PRECISION = 8
// SVG paths do not receive the font hinting used by live browser text. Blend
// to the real destination briefly at the end so the rasterizer, not a generic
// vector path, owns the settled pixels.
const ENDPOINT_HANDOFF_MS = 96
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export type FontMorphFontRole = 'sans' | 'serif'
type FontRole = FontMorphFontRole
type Polygon = [number, number][]
export type MorphTextResolver = (
  locale: string | undefined,
  translationHash: string | undefined,
  recordedText: string,
) => string | undefined

export interface FontMorphEvent {
  type: number
  timestamp: number
  data?: unknown
}

export interface FontMorphReplayFrame<Event extends FontMorphEvent = FontMorphEvent> {
  time: number
  document: Document | null
  locale?: string
  events: Event[]
}

export interface FontMorphConfiguration {
  /** Outline-font URLs, ordered from the primary face to glyph fallbacks. */
  fontFiles: Record<FontMorphFontRole, readonly string[]>
  /** Class placed on the document root while a nested capture viewport is active. */
  recordingClass?: string
  /** Element representing that nested capture viewport. */
  captureSelector?: string
  /** Maps a computed CSS font-family string to one of the configured faces. */
  resolveFontRole?: (fontFamily: string) => FontMorphFontRole
  /** Optional stable text identity copied into semantic recording events. */
  resolveTextIdentity?: (element: HTMLElement) => string | undefined
}

const defaultConfiguration: FontMorphConfiguration = {
  fontFiles: { sans: [], serif: [] },
  recordingClass: 'font-morph-recording',
  captureSelector: '[data-font-morph-capture]',
  resolveFontRole: (fontFamily) =>
    fontFamily.toLowerCase().includes('serif') ? 'serif' : 'sans',
}

let configuration = defaultConfiguration

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
  index: number
  path: string
  polygon: Polygon
  depth: number
  parentIndex: number | null
  center: [number, number]
  area: number
  bounds: Rect
}

interface GlyphOutline {
  contours: OutlineContour[]
  bounds: Rect
}

interface OutlineInstance {
  role: FontRole
  weight: number
  opticalSize: number
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
  handoffTarget: {
    element: HTMLElement
    opacity: string
    priority: string
  } | null
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
  handoffElement: HTMLElement | null
  handoffAnimation: Animation | null
}

const recordedMorphCache = new WeakMap<FontMorphEvent[], ReturnType<typeof indexMorphs>>()
let replayOutlineCache = new WeakMap<RecordedFontMorph, Map<string, PreparedOutline>>()
const normalizedOutlineCache = new Map<string, NormalizedOutline>()

export const FONT_MORPH_RECORD_EVENT = 'font-morph:record'
export const FONT_MORPH_EVENT_TAG = 'font-morph'
export const SETTLED_TEXT_HOLD_MS = 500

// Recordings made before font-morph became a standalone package use this tag.
// Keep accepting it indefinitely so extracting the library never invalidates
// previously captured timelines.
const LEGACY_FONT_MORPH_EVENT_TAG = 'gt-font-morph'

function isFontMorphEventTag(tag: string | undefined) {
  return tag === FONT_MORPH_EVENT_TAG || tag === LEGACY_FONT_MORPH_EVENT_TAG
}

let activeMorph: ActiveMorph | null = null
let outlineRuntimePromise: Promise<OutlineRuntime> | null = null
let loadedOutlineRuntime: OutlineRuntime | null = null
let nextMaskId = 0

/** Configure the two outline-font families used by subsequent preparations. */
export function configureFontMorph(options: FontMorphConfiguration) {
  configuration = {
    fontFiles: {
      sans: [...options.fontFiles.sans],
      serif: [...options.fontFiles.serif],
    },
    recordingClass: options.recordingClass ?? defaultConfiguration.recordingClass,
    captureSelector: options.captureSelector ?? defaultConfiguration.captureSelector,
    resolveFontRole: options.resolveFontRole ?? defaultConfiguration.resolveFontRole,
    resolveTextIdentity: options.resolveTextIdentity,
  }
  outlineRuntimePromise = null
  loadedOutlineRuntime = null
  replayOutlineCache = new WeakMap()
  normalizedOutlineCache.clear()
}

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
  return configuration.resolveFontRole?.(fontFamily) ?? 'sans'
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
  const captureElement = ownerDocument.documentElement.classList.contains(
    configuration.recordingClass!,
  )
    ? ownerDocument.querySelector<HTMLElement>(configuration.captureSelector!)
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
    translationHash: configuration.resolveTextIdentity?.(element),
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

function endpointHandoffOpacities(progress: number, duration: number) {
  const handoffPortion = Math.min(1, ENDPOINT_HANDOFF_MS / Math.max(1, duration))
  const handoffStart = 1 - handoffPortion
  const handoffProgress = Math.min(1, Math.max(0, (progress - handoffStart) / handoffPortion))
  const phase = handoffProgress * (Math.PI / 2)
  return {
    source: Math.cos(phase),
    destination: Math.sin(phase),
  }
}

function startEndpointHandoff(
  morph: ActiveMorph,
  element: HTMLElement,
  duration: number,
  progress: number,
) {
  if (morph.handoffElement !== element) {
    morph.handoffAnimation?.cancel()
    morph.handoffElement = element
    const handoffOffset = Math.max(0, 1 - ENDPOINT_HANDOFF_MS / Math.max(1, duration))
    const handoffFrames: Keyframe[] = Array.from({ length: 9 }, (_, index) => {
      const handoffProgress = index / 8
      return {
        opacity: Math.sin(handoffProgress * (Math.PI / 2)),
        offset: handoffOffset + handoffProgress * (1 - handoffOffset),
      }
    })
    if (handoffOffset > 0) handoffFrames.unshift({ opacity: 0, offset: 0 })
    morph.handoffAnimation = element.animate(handoffFrames, {
      duration,
      easing: 'linear',
      fill: 'both',
    })
    morph.handoffAnimation.pause()
  }
  // Drive the animation from the same logical progress as the SVG instead of
  // a second wall clock. Besides keeping their opacities complementary, this
  // stays correct across a long frame or a destination element replacement.
  if (morph.handoffAnimation) morph.handoffAnimation.currentTime = progress * duration
}

function restoreReplayHandoff(state: ReplayMorphState | null) {
  if (!state?.handoffTarget) return
  const { element, opacity, priority } = state.handoffTarget
  if (opacity) element.style.setProperty('opacity', opacity, priority)
  else element.style.removeProperty('opacity')
  state.handoffTarget = null
}

function setReplayHandoff(state: ReplayMorphState, element: HTMLElement | null, opacity: number) {
  if (state.handoffTarget?.element !== element) {
    restoreReplayHandoff(state)
    if (element) {
      state.handoffTarget = {
        element,
        opacity: element.style.getPropertyValue('opacity'),
        priority: element.style.getPropertyPriority('opacity'),
      }
    }
  }
  // Inline !important also overrides the hiding rule embedded in recordings
  // made before the deterministic endpoint handoff was introduced.
  element?.style.setProperty('opacity', String(opacity), 'important')
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

function numericFontWeight(value: string, fallback: number) {
  const weight = Number.parseFloat(value)
  return Number.isFinite(weight) ? weight : fallback
}

function outlineInstance(endpoint: GlyphEndpoint): OutlineInstance {
  const role = endpoint.style.fontRole
  return {
    role,
    weight: numericFontWeight(endpoint.style.fontWeight, role === 'sans' ? 500 : 600),
    // Optical size is part of the serif-role outline identity. Excluding sans
    // font size avoids duplicate cached outlines that differ only by scale.
    opticalSize: role === 'serif' ? fontSize(endpoint) : 0,
  }
}

function counterpartOutlineInstance(role: FontRole): OutlineInstance {
  const rootStyle = getComputedStyle(document.documentElement)
  const value = (property: string, fallback: number) => {
    const parsed = Number.parseFloat(rootStyle.getPropertyValue(property))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    role,
    weight: value(`--font-morph-${role}-weight`, role === 'sans' ? 500 : 600),
    opticalSize: role === 'serif' ? value('--font-morph-serif-optical-size', 23) : 0,
  }
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

function smoothColorProgress(progress: number) {
  // Smootherstep keeps the color velocity at zero at both endpoints, so color
  // begins and settles gently while remaining deterministic for replay.
  return progress * progress * progress * (progress * (progress * 6 - 15) + 10)
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

function renderOptions(instance: OutlineInstance): RenderOptions {
  const variation =
    instance.role === 'sans' ? { wght: instance.weight } : { opsz: instance.opticalSize }
  return {
    kerning: true,
    letterSpacing: 0,
    features: { liga: false, rlig: false },
    // opentype.js 2 supports variable coordinates, but @types/opentype.js
    // still describes the pre-variable RenderOptions surface.
    variation,
  } as RenderOptions
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

function polygonBounds(polygon: Polygon): Rect {
  const horizontal = polygon.map(([x]) => x)
  const vertical = polygon.map(([, y]) => y)
  const left = Math.min(...horizontal)
  const top = Math.min(...vertical)
  return {
    left,
    top,
    width: Math.max(Number.EPSILON, Math.max(...horizontal) - left),
    height: Math.max(Number.EPSILON, Math.max(...vertical) - top),
  }
}

function combinedBounds(contours: OutlineContour[]): Rect {
  if (!contours.length) return { left: 0, top: 0, width: 1, height: 1 }
  const left = Math.min(...contours.map((contour) => contour.bounds.left))
  const top = Math.min(...contours.map((contour) => contour.bounds.top))
  const right = Math.max(...contours.map((contour) => contour.bounds.left + contour.bounds.width))
  const bottom = Math.max(...contours.map((contour) => contour.bounds.top + contour.bounds.height))
  return {
    left,
    top,
    width: Math.max(Number.EPSILON, right - left),
    height: Math.max(Number.EPSILON, bottom - top),
  }
}

function classifyContours(paths: string[], runtime: KuteMorphRuntime): OutlineContour[] {
  const contours: OutlineContour[] = paths.map((path, index) => {
    const polygon = runtime.getInterpolationPoints(path, path, MORPH_PRECISION)[0]
    const { area, center } = polygonStats(polygon)
    return {
      index,
      path,
      polygon,
      depth: 0,
      parentIndex: null,
      center,
      area,
      bounds: polygonBounds(polygon),
    }
  })

  for (const contour of contours) {
    const sample = contour.polygon[0]
    const containers = contours
      .filter(
        (candidate) =>
          candidate !== contour &&
          candidate.area > contour.area &&
          pointInPolygon(sample, candidate.polygon),
      )
      .sort((left, right) => left.area - right.area)
    contour.parentIndex = containers[0]?.index ?? null
    contour.depth = containers.length
  }
  return contours
}

function outlineFont(text: string, fonts: readonly Font[]) {
  const characters = [...text]
  return fonts.find((candidate) => characters.every((character) => candidate.hasChar(character)))
}

function buildOutline(
  text: string,
  font: Font,
  instance: OutlineInstance,
  runtime: KuteMorphRuntime,
): GlyphOutline[] {
  // Build once in a common 1,000-unit em square. Endpoint size, line box, and
  // letter spacing are cheap affine transforms applied only after navigation
  // reveals the target.
  const canonicalBaseline = (font.ascender / font.unitsPerEm) * MORPH_VIEWBOX_SIZE
  const paths = font.getPaths(
    text,
    0,
    canonicalBaseline,
    MORPH_VIEWBOX_SIZE,
    renderOptions(instance),
  )
  return paths.map((path) => {
    const contours = splitContours(path.commands).map((commands) => contourPath(commands))
    const classified = classifyContours(contours, runtime)
    return { contours: classified, bounds: combinedBounds(classified) }
  })
}

function relativeContourMetrics(contour: OutlineContour, glyph: GlyphOutline) {
  const glyphArea = glyph.bounds.width * glyph.bounds.height
  return {
    center: [
      (contour.center[0] - glyph.bounds.left) / glyph.bounds.width,
      (contour.center[1] - glyph.bounds.top) / glyph.bounds.height,
    ] as [number, number],
    width: contour.bounds.width / glyph.bounds.width,
    height: contour.bounds.height / glyph.bounds.height,
    area: contour.area / glyphArea,
  }
}

function contourPairCost(
  source: OutlineContour,
  target: OutlineContour,
  sourceGlyph: GlyphOutline,
  targetGlyph: GlyphOutline,
) {
  const sourceMetrics = relativeContourMetrics(source, sourceGlyph)
  const targetMetrics = relativeContourMetrics(target, targetGlyph)
  const centerDistance = Math.hypot(
    sourceMetrics.center[0] - targetMetrics.center[0],
    sourceMetrics.center[1] - targetMetrics.center[1],
  )
  const areaDistance = Math.abs(
    Math.log((sourceMetrics.area + Number.EPSILON) / (targetMetrics.area + Number.EPSILON)),
  )
  const sizeDistance =
    Math.abs(sourceMetrics.width - targetMetrics.width) +
    Math.abs(sourceMetrics.height - targetMetrics.height)
  const sourceChildren = sourceGlyph.contours.filter(
    (contour) => contour.parentIndex === source.index,
  ).length
  const targetChildren = targetGlyph.contours.filter(
    (contour) => contour.parentIndex === target.index,
  ).length
  return (
    centerDistance * 400 +
    areaDistance * 80 +
    sizeDistance * 120 +
    Math.abs(sourceChildren - targetChildren) * 160
  )
}

/** Minimum-cost one-to-one assignment. Dummy rows or columns select which
 * unmatched components should collapse without disturbing the other strokes. */
function minimumAssignment(costs: number[][]) {
  const size = costs.length
  if (!size) return []
  const rowPotential = new Array<number>(size + 1).fill(0)
  const columnPotential = new Array<number>(size + 1).fill(0)
  const columnMatch = new Array<number>(size + 1).fill(0)
  const predecessor = new Array<number>(size + 1).fill(0)

  for (let row = 1; row <= size; row += 1) {
    columnMatch[0] = row
    let column = 0
    const minimum = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY)
    const visited = new Array<boolean>(size + 1).fill(false)
    do {
      visited[column] = true
      const matchedRow = columnMatch[column]
      let delta = Number.POSITIVE_INFINITY
      let nextColumn = 0
      for (let candidate = 1; candidate <= size; candidate += 1) {
        if (visited[candidate]) continue
        const reducedCost =
          costs[matchedRow - 1][candidate - 1] -
          rowPotential[matchedRow] -
          columnPotential[candidate]
        if (reducedCost < minimum[candidate]) {
          minimum[candidate] = reducedCost
          predecessor[candidate] = column
        }
        if (minimum[candidate] < delta) {
          delta = minimum[candidate]
          nextColumn = candidate
        }
      }
      for (let candidate = 0; candidate <= size; candidate += 1) {
        if (visited[candidate]) {
          rowPotential[columnMatch[candidate]] += delta
          columnPotential[candidate] -= delta
        } else {
          minimum[candidate] -= delta
        }
      }
      column = nextColumn
    } while (columnMatch[column] !== 0)

    do {
      const previousColumn = predecessor[column]
      columnMatch[column] = columnMatch[previousColumn]
      column = previousColumn
    } while (column !== 0)
  }

  const assignment = new Array<number>(size).fill(-1)
  for (let column = 1; column <= size; column += 1) {
    if (columnMatch[column]) assignment[columnMatch[column] - 1] = column - 1
  }
  return assignment
}

function squaredDistance(left: [number, number], right: [number, number]) {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2
}

function closestBoundaryPoint(reference: OutlineContour, addition: OutlineContour) {
  let closest = reference.polygon[0]
  let minimumDistance = Number.POSITIVE_INFINITY
  for (const referencePoint of reference.polygon) {
    for (const additionPoint of addition.polygon) {
      const distance = squaredDistance(referencePoint, additionPoint)
      if (distance < minimumDistance) {
        minimumDistance = distance
        closest = referencePoint
      }
    }
  }
  return { point: closest, distance: minimumDistance }
}

function mapGlyphPoint(point: [number, number], from: GlyphOutline, to: GlyphOutline) {
  return [
    to.bounds.left + ((point[0] - from.bounds.left) / from.bounds.width) * to.bounds.width,
    to.bounds.top + ((point[1] - from.bounds.top) / from.bounds.height) * to.bounds.height,
  ] as [number, number]
}

function nearestPoint(contour: OutlineContour, point: [number, number]) {
  return contour.polygon.reduce(
    (closest, candidate) =>
      squaredDistance(candidate, point) < squaredDistance(closest, point) ? candidate : closest,
    contour.polygon[0],
  )
}

function pairGlyphContours(source: GlyphOutline, target: GlyphOutline) {
  const pairs: [OutlineContour, OutlineContour][] = []

  const collapseSubtree = (
    glyph: GlyphOutline,
    contour: OutlineContour,
    side: 'source' | 'target',
    anchor: [number, number],
  ) => {
    if (side === 'source') pairs.push([contour, collapsedContour(contour, anchor)])
    else pairs.push([collapsedContour(contour, anchor), contour])
    for (const child of glyph.contours.filter(
      (candidate) => candidate.parentIndex === contour.index,
    )) {
      collapseSubtree(glyph, child, side, anchor)
    }
  }

  const attachmentAnchor = (
    contour: OutlineContour,
    side: 'source' | 'target',
    matched: [OutlineContour, OutlineContour][],
  ) => {
    if (!matched.length) {
      const from = side === 'source' ? source : target
      const to = side === 'source' ? target : source
      return mapGlyphPoint(contour.center, from, to)
    }
    const related = matched.reduce(
      (best, candidate) => {
        const reference = side === 'source' ? candidate[0] : candidate[1]
        const distance = closestBoundaryPoint(reference, contour).distance
        return distance < best.distance ? { pair: candidate, distance } : best
      },
      { pair: matched[0], distance: Number.POSITIVE_INFINITY },
    ).pair
    const reference = side === 'source' ? related[0] : related[1]
    const counterpart = side === 'source' ? related[1] : related[0]
    const fromGlyph = side === 'source' ? source : target
    const toGlyph = side === 'source' ? target : source
    const attachment = closestBoundaryPoint(reference, contour).point
    return nearestPoint(counterpart, mapGlyphPoint(attachment, fromGlyph, toGlyph))
  }

  const pairChildren = (
    sourceParent: number | null,
    targetParent: number | null,
    parentPair?: [OutlineContour, OutlineContour],
  ) => {
    const sourceChildren = source.contours.filter((contour) => contour.parentIndex === sourceParent)
    const targetChildren = target.contours.filter((contour) => contour.parentIndex === targetParent)
    const size = Math.max(sourceChildren.length, targetChildren.length)
    if (!size) return
    const costs = Array.from({ length: size }, (_, sourceIndex) =>
      Array.from({ length: size }, (_, targetIndex) => {
        const sourceContour = sourceChildren[sourceIndex]
        const targetContour = targetChildren[targetIndex]
        return sourceContour && targetContour
          ? contourPairCost(sourceContour, targetContour, source, target)
          : 0
      }),
    )

    const matched: [OutlineContour, OutlineContour][] = []
    const unmatchedSource: OutlineContour[] = []
    const unmatchedTarget: OutlineContour[] = []
    for (const [sourceIndex, targetIndex] of minimumAssignment(costs).entries()) {
      const sourceContour = sourceChildren[sourceIndex]
      const targetContour = targetChildren[targetIndex]
      if (sourceContour && targetContour) {
        matched.push([sourceContour, targetContour])
      } else if (sourceContour) {
        unmatchedSource.push(sourceContour)
      } else if (targetContour) {
        unmatchedTarget.push(targetContour)
      }
    }
    const attachmentPairs = matched.length ? matched : parentPair ? [parentPair] : []
    for (const pair of matched) {
      pairs.push(pair)
      pairChildren(pair[0].index, pair[1].index, pair)
    }
    for (const contour of unmatchedSource) {
      collapseSubtree(
        source,
        contour,
        'source',
        attachmentAnchor(contour, 'source', attachmentPairs),
      )
    }
    for (const contour of unmatchedTarget) {
      collapseSubtree(
        target,
        contour,
        'target',
        attachmentAnchor(contour, 'target', attachmentPairs),
      )
    }
  }

  // Pair connected components first, then recurse only within their owned
  // counters. A hole can no longer migrate into another stroke of the glyph.
  pairChildren(null, null)
  return pairs
}

function collapsedContour(contour: OutlineContour, anchor = contour.center): OutlineContour {
  const [x, y] = anchor
  const radius = 0.001
  const polygon: Polygon = [
    [x - radius, y],
    [x, y - radius],
    [x + radius, y],
    [x, y + radius],
  ]
  return {
    ...contour,
    path: polygonPath(polygon),
    polygon,
    center: anchor,
    area: 0,
    bounds: polygonBounds(polygon),
  }
}

interface BoundaryFeature {
  x: number
  y: number
  tangentX: number
  tangentY: number
}

function boundaryFeatures(polygon: Polygon): BoundaryFeature[] {
  const bounds = polygonBounds(polygon)
  const normalized = polygon.map(
    ([x, y]) =>
      [(x - bounds.left) / bounds.width, (y - bounds.top) / bounds.height] as [number, number],
  )
  return normalized.map(([x, y], index) => {
    const previous = normalized[(index + normalized.length - 1) % normalized.length]
    const next = normalized[(index + 1) % normalized.length]
    const tangentX = next[0] - previous[0]
    const tangentY = next[1] - previous[1]
    const tangentLength = Math.max(Number.EPSILON, Math.hypot(tangentX, tangentY))
    return {
      x,
      y,
      tangentX: tangentX / tangentLength,
      tangentY: tangentY / tangentLength,
    }
  })
}

function boundaryPairCost(
  source: BoundaryFeature,
  target: BoundaryFeature,
  sourceIndex: number,
  targetIndex: number,
  band: number,
) {
  const position = (source.x - target.x) ** 2 + (source.y - target.y) ** 2
  const tangent =
    1 -
    Math.max(-1, Math.min(1, source.tangentX * target.tangentX + source.tangentY * target.tangentY))
  const phase = ((sourceIndex - targetIndex) / band) ** 2
  return position + tangent * 0.2 + phase * 0.15
}

function pointAlongBoundary(polygon: Polygon, index: number): [number, number] {
  const wrapped = ((index % polygon.length) + polygon.length) % polygon.length
  const startIndex = Math.floor(wrapped)
  const progress = wrapped - startIndex
  const start = polygon[startIndex]
  const end = polygon[(startIndex + 1) % polygon.length]
  return [interpolate(start[0], end[0], progress), interpolate(start[1], end[1], progress)]
}

function sectionedBoundaryCorrespondence(
  source: Polygon,
  target: Polygon,
  warpingPath: [number, number][],
): [Polygon, Polygon] {
  const length = source.length
  // The DTW path discovers local structural correspondence. Convert that path
  // into strictly ordered section anchors, then resample every section. This
  // keeps the useful local match without leaving duplicated points that can
  // pinch into visible blobs halfway through the morph.
  const landmarkSpacing = Math.max(3, Math.ceil(length / 24))
  const sourceLandmarks: number[] = []
  for (let index = 0; index < length; index += landmarkSpacing) sourceLandmarks.push(index)
  sourceLandmarks.push(length)

  const targetLandmarks = sourceLandmarks.map((sourceIndex) => {
    if (sourceIndex === length) return length
    const candidates = warpingPath.filter(([candidate]) => candidate === sourceIndex)
    if (candidates.length) {
      return Math.round(
        candidates.reduce((sum, [, targetIndex]) => sum + targetIndex, 0) / candidates.length,
      )
    }
    return sourceIndex
  })
  targetLandmarks[0] = 0
  targetLandmarks[targetLandmarks.length - 1] = length
  for (let index = 1; index < targetLandmarks.length - 1; index += 1) {
    const remaining = targetLandmarks.length - 1 - index
    targetLandmarks[index] = Math.min(
      length - remaining,
      Math.max(targetLandmarks[index - 1] + 1, targetLandmarks[index]),
    )
  }

  const matchedSource: Polygon = []
  const matchedTarget: Polygon = []
  for (let section = 0; section < sourceLandmarks.length - 1; section += 1) {
    const sourceStart = sourceLandmarks[section]
    const sourceEnd = sourceLandmarks[section + 1]
    const targetStart = targetLandmarks[section]
    const targetEnd = targetLandmarks[section + 1]
    const segmentCount = Math.max(sourceEnd - sourceStart, targetEnd - targetStart)
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const sectionProgress = segment / segmentCount
      matchedSource.push(
        pointAlongBoundary(source, interpolate(sourceStart, sourceEnd, sectionProgress)),
      )
      matchedTarget.push(
        pointAlongBoundary(target, interpolate(targetStart, targetEnd, sectionProgress)),
      )
    }
  }
  return [matchedSource, matchedTarget]
}

/**
 * Refine KUTE's single cyclic contour match with a banded, monotonic boundary
 * assignment. Repeated points are harmless at either endpoint, while the
 * ordering guarantee prevents one stroke region from donating its outline to
 * a distant region of the same contour.
 */
function localBoundaryCorrespondence(source: Polygon, target: Polygon): [Polygon, Polygon] {
  if (source.length !== target.length || source.length < 4) return [source, target]
  const length = source.length
  const band = Math.max(3, Math.ceil(length * 0.08))
  const sourceFeatures = boundaryFeatures(source)
  const targetFeatures = boundaryFeatures(target)
  const directions = new Uint8Array(length * length)
  let previous = new Float64Array(length)
  previous.fill(Number.POSITIVE_INFINITY)

  for (let sourceIndex = 0; sourceIndex < length; sourceIndex += 1) {
    const current = new Float64Array(length)
    current.fill(Number.POSITIVE_INFINITY)
    const firstTarget = Math.max(0, sourceIndex - band)
    const lastTarget = Math.min(length - 1, sourceIndex + band)
    for (let targetIndex = firstTarget; targetIndex <= lastTarget; targetIndex += 1) {
      const pointCost = boundaryPairCost(
        sourceFeatures[sourceIndex],
        targetFeatures[targetIndex],
        sourceIndex,
        targetIndex,
        band,
      )
      if (sourceIndex === 0 && targetIndex === 0) {
        current[targetIndex] = pointCost
        continue
      }

      let predecessorCost = Number.POSITIVE_INFINITY
      let direction = 0
      if (sourceIndex > 0 && targetIndex > 0 && previous[targetIndex - 1] < predecessorCost) {
        predecessorCost = previous[targetIndex - 1]
        direction = 1
      }
      // Advancing only one boundary duplicates a point. Charge a small cost so
      // a local mismatch can flex without allowing long stretches to collapse.
      if (sourceIndex > 0 && previous[targetIndex] + 0.04 < predecessorCost) {
        predecessorCost = previous[targetIndex] + 0.04
        direction = 2
      }
      if (targetIndex > 0 && current[targetIndex - 1] + 0.04 < predecessorCost) {
        predecessorCost = current[targetIndex - 1] + 0.04
        direction = 3
      }
      if (direction) {
        current[targetIndex] = pointCost + predecessorCost
        directions[sourceIndex * length + targetIndex] = direction
      }
    }
    previous = current
  }

  if (!Number.isFinite(previous[length - 1])) return [source, target]
  const warpingPath: [number, number][] = []
  let sourceIndex = length - 1
  let targetIndex = length - 1
  while (true) {
    warpingPath.push([sourceIndex, targetIndex])
    if (sourceIndex === 0 && targetIndex === 0) break
    const direction = directions[sourceIndex * length + targetIndex]
    if (direction === 1) {
      sourceIndex -= 1
      targetIndex -= 1
    } else if (direction === 2) {
      sourceIndex -= 1
    } else if (direction === 3) {
      targetIndex -= 1
    } else {
      return [source, target]
    }
  }
  warpingPath.reverse()
  return sectionedBoundaryCorrespondence(source, target, warpingPath)
}

async function loadOutlineRuntime() {
  if (!outlineRuntimePromise) {
    outlineRuntimePromise = Promise.all([
      import('opentype.js'),
      import('kute.js/src/components/svgMorph'),
      Promise.all(
        Object.entries(configuration.fontFiles).map(async ([role, urls]) => {
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
  sourceInstance: OutlineInstance,
  targetInstance: OutlineInstance,
  runtime: OutlineRuntime,
): NormalizedOutline {
  const cacheKey = JSON.stringify([text, sourceInstance, targetInstance])
  const cached = normalizedOutlineCache.get(cacheKey)
  if (cached) return cached

  const reverseKey = JSON.stringify([text, targetInstance, sourceInstance])
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

  const sourceFont = outlineFont(text, runtime.fonts[sourceInstance.role])
  const targetFont = outlineFont(text, runtime.fonts[targetInstance.role])
  if (!sourceFont || !targetFont) {
    const normalized: NormalizedOutline = {
      contours: null,
      fallback: 'unsupported-glyph',
    }
    normalizedOutlineCache.set(cacheKey, normalized)
    return normalized
  }

  const sourceGlyphs = buildOutline(text, sourceFont, sourceInstance, runtime)
  const targetGlyphs = buildOutline(text, targetFont, targetInstance, runtime)
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
      const kutePoints = runtime.getInterpolationPoints(
        sourceContour.path,
        targetContour.path,
        MORPH_PRECISION,
      )
      const [sourcePoints, targetPoints] = localBoundaryCorrespondence(...kutePoints)
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
    outlineInstance(source),
    outlineInstance(target),
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
    normalizedOutline(
      captured.text,
      outlineInstance(captured),
      counterpartOutlineInstance(targetRole),
      runtime,
    )
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
  sourceOpacity = 1,
  runtime?: KuteMorphRuntime,
) {
  const { layer, source, target, contours } = prepared
  layer.style.opacity = String(sourceOpacity)
  setLayerBox(
    layer,
    interpolateRect(source.rect, target.rect, geometryProgress),
    layer.ownerDocument,
  )
  const colorProgress = smoothColorProgress(outlineProgress)
  setLayerColor(layer, {
    red: interpolate(source.style.color.red, target.style.color.red, colorProgress),
    green: interpolate(source.style.color.green, target.style.color.green, colorProgress),
    blue: interpolate(source.style.color.blue, target.style.color.blue, colorProgress),
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
  // Release the CSS hiding rule while the destination animation is still at
  // full opacity. Cancelling its compositor effect afterward cannot expose a
  // zero-opacity frame, even if style and compositor commits straddle frames.
  document.documentElement.removeAttribute('data-font-morph-active')
  morph.handoffAnimation?.cancel()
  morph.layer.remove()
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
  startEndpointHandoff(morph, target.element, duration, 0)
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
    if (currentTarget) {
      prepared.target = currentTarget
      startEndpointHandoff(morph, currentTarget.element, duration, linearProgress)
    }
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
    const handoff = currentTarget
      ? endpointHandoffOpacities(linearProgress, duration)
      : { source: 1, destination: 0 }
    paintPreparedMorph(prepared, geometryProgress, linearProgress, handoff.source, runtime)

    if (linearProgress < 1) {
      morph.frame = requestAnimationFrame(paint)
    } else {
      cleanup(morph)
    }
  }

  morph.frame = requestAnimationFrame(paint)
}

function recordedActivationTimestamp(
  events: FontMorphEvent[],
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

function indexMorphs(events: FontMorphEvent[]) {
  return events.flatMap((event, eventIndex) => {
    const customEvent = event as typeof event & {
      data?: { tag?: string; payload?: RecordedFontMorph }
    }
    const payload = customEvent.data?.payload
    return customEvent.type === 5 &&
      isFontMorphEventTag(customEvent.data?.tag) &&
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
 * embedded in font-morph events. A replay host reads this value while constructing
 * its deterministic timeline; the frame director later skips the reservation
 * when the translated destination is not visible.
 */
export function reserveFontMorphSettledTextHolds<Event extends FontMorphEvent>(
  events: Event[],
): Event[] {
  let changed = false
  const prepared = events.map((event) => {
    const customEvent = event as typeof event & {
      data?: { tag?: string; payload?: RecordedFontMorph }
    }
    const payload = customEvent.data?.payload
    if (
      customEvent.type !== 5 ||
      !isFontMorphEventTag(customEvent.data?.tag) ||
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
    } as Event
  })
  return changed ? prepared : events
}

function recordedMorphAt(frame: FontMorphReplayFrame) {
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

function recordedCaptureRatio(events: FontMorphEvent[]) {
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
 * Computes KUTE's expensive point correspondence before a replayer starts its
 * wall clock. Cached templates contain no DOM nodes and can therefore be
 * mounted into the replay iframe synchronously on their first visible frame.
 */
export async function prepareFontMorphReplay(
  events: FontMorphEvent[],
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
 * Deterministic replay director. KUTE prepares the corresponding contour
 * samples, while every rendered path derives from absolute replay time. That
 * makes seeking and rewinding video-like instead of carrying tween state.
 */
export function createFontMorphReplayDirector(resolveText?: MorphTextResolver) {
  let state: ReplayMorphState | null = null
  let generation = 0
  let runtime: OutlineRuntime | undefined

  const clear = () => {
    generation += 1
    restoreReplayHandoff(state)
    state?.document.documentElement.removeAttribute('data-font-morph-fallback')
    state?.layer.remove()
    state = null
  }

  return (frame: FontMorphReplayFrame) => {
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
        handoffTarget: null,
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
        // A replay host can preload this runtime before mounting its player, so
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
      restoreReplayHandoff(state)
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
    const handoff = currentTarget
      ? endpointHandoffOpacities(linearProgress, active.payload.duration)
      : { source: 1, destination: 0 }
    setReplayHandoff(state, currentTarget?.element ?? null, handoff.destination)
    paintPreparedMorph(state.prepared, geometryProgress, linearProgress, handoff.source, runtime)
  }
}

/**
 * Captures the currently mounted endpoint and waits for navigation to mount
 * another element with the same key. The recorded geometry is relative to the
 * configured capture frame; SVG viewBox coordinates contain no viewport pixels.
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
    handoffElement: null,
    handoffAnimation: null,
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
