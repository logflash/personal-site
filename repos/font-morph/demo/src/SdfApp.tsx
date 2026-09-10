import { useEffect, useRef, useState } from 'react'
import { renderFontMorphSdfFrame, type FontMorphSdfWarpRegion } from '../../src/sdf-runtime'

interface Box { left: number; top: number; width: number; height: number }
interface ShapedGlyph { unicode: string; x: number; y: number; advanceWidth: number }
interface ShapedRun { text: string; glyphs: ShapedGlyph[]; advanceWidth: number }
interface SerializedEndpoint {
  advanceWidth: number
  textureBounds: { xMin: number; yMin: number; xMax: number; yMax: number }
  distanceBase64: string
}
interface SerializedGlyph {
  unicode: string
  size: number
  maximumDistance: number
  warpRegions: FontMorphSdfWarpRegion[]
  source: SerializedEndpoint
  target: SerializedEndpoint
}
interface PairData { glyphs: Record<string, SerializedGlyph> }
interface SampleData {
  label: string
  text: string
  language: string
  sourceLabel: string
  targetLabel: string
  pair: string
  sourceRun: ShapedRun
  targetRun: ShapedRun
}
interface DemoData {
  samples: Record<string, SampleData>
  pairs: Record<string, PairData>
}
interface EndpointLayout {
  box: Box
  baseline: number
  scaleX: number
  scaleY: number
}

function decode(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function interpolate(source: number, target: number, progress: number) {
  return source + (target - source) * progress
}

function layoutFor(element: HTMLElement, stage: DOMRect, run: ShapedRun): EndpointLayout {
  const bounds = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const fontSize = Number.parseFloat(style.fontSize)
  const measurement = document.createElement('canvas').getContext('2d')
  if (!measurement) throw new Error('Canvas text measurement is unavailable')
  measurement.font = style.font
  const metrics = measurement.measureText(run.text)
  const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.8
  const descent = metrics.fontBoundingBoxDescent || fontSize * 0.2
  const lineBaseline = Math.floor((bounds.height - ascent - descent) / 2) + ascent
  return {
    box: { left: bounds.left - stage.left, top: bounds.top - stage.top, width: bounds.width, height: bounds.height },
    baseline: bounds.top - stage.top + lineBaseline,
    scaleX: bounds.width / run.advanceWidth,
    scaleY: fontSize,
  }
}

function glyphBox(layout: EndpointLayout, shaped: ShapedGlyph, endpoint: SerializedEndpoint): Box {
  const bounds = endpoint.textureBounds
  return {
    left: layout.box.left + shaped.x * layout.scaleX + bounds.xMin * layout.scaleX,
    top: layout.baseline - bounds.yMax * layout.scaleY,
    width: (bounds.xMax - bounds.xMin) * layout.scaleX,
    height: (bounds.yMax - bounds.yMin) * layout.scaleY,
  }
}

function interpolatedBox(source: Box, target: Box, progress: number): Box {
  return {
    left: interpolate(source.left, target.left, progress),
    top: interpolate(source.top, target.top, progress),
    width: interpolate(source.width, target.width, progress),
    height: interpolate(source.height, target.height, progress),
  }
}

export function SdfApp() {
  const [data, setData] = useState<DemoData | null>(null)
  const [locale, setLocale] = useState('en')
  const [progress, setProgress] = useState(0.5)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [error, setError] = useState('')
  const stageRef = useRef<HTMLElement>(null)
  const sourceRef = useRef<HTMLSpanElement>(null)
  const targetRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameVersionRef = useRef(0)
  const distancesRef = useRef(new Map<string, { source: Uint8Array; target: Uint8Array }>())
  const glyphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sample = data?.samples[locale]

  useEffect(() => {
    fetch('/generated/sdf.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load distance-field demo data (${response.status})`)
        return response.json() as Promise<DemoData>
      })
      .then(setData, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => setLayoutVersion((value) => value + 1)
    void document.fonts.ready.then(update)
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [sample])

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    const sourceElement = sourceRef.current
    const targetElement = targetRef.current
    if (!canvas || !stage || !sourceElement || !targetElement || !data || !sample) return
    const pair = data.pairs[sample.pair]
    const stageBounds = stage.getBoundingClientRect()
    const sourceLayout = layoutFor(sourceElement, stageBounds, sample.sourceRun)
    const targetLayout = layoutFor(targetElement, stageBounds, sample.targetRun)
    const ratio = Math.min(3, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.round(stageBounds.width * ratio))
    canvas.height = Math.max(1, Math.round(stageBounds.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, stageBounds.width, stageBounds.height)
    context.imageSmoothingEnabled = true
    const glyphCanvas = glyphCanvasRef.current ?? document.createElement('canvas')
    glyphCanvasRef.current = glyphCanvas

    for (let index = 0; index < sample.sourceRun.glyphs.length; index += 1) {
      const sourceGlyph = sample.sourceRun.glyphs[index]
      const targetGlyph = sample.targetRun.glyphs[index]
      const compiled = pair.glyphs[sourceGlyph.unicode]
      const cacheKey = `${sample.pair}:${sourceGlyph.unicode}`
      let distances = distancesRef.current.get(cacheKey)
      if (!distances) {
        distances = {
          source: decode(compiled.source.distanceBase64),
          target: decode(compiled.target.distanceBase64),
        }
        distancesRef.current.set(cacheKey, distances)
      }
      glyphCanvas.width = compiled.size
      glyphCanvas.height = compiled.size
      const glyphContext = glyphCanvas.getContext('2d')!
      const image = glyphContext.createImageData(compiled.size, compiled.size)
      const frame = renderFontMorphSdfFrame({
        ...compiled,
        source: { ...compiled.source, fontInstanceId: '', glyphId: 0, distance: distances.source },
        target: { ...compiled.target, fontInstanceId: '', glyphId: 0, distance: distances.target },
      }, progress)
      for (let pixel = 0; pixel < frame.length; pixel += 1) {
        const distance = frame[pixel]
        const coverage = Math.max(0, Math.min(1, 0.5 + (distance - 128) / 12))
        image.data[pixel * 4] = 23
        image.data[pixel * 4 + 1] = 23
        image.data[pixel * 4 + 2] = 23
        image.data[pixel * 4 + 3] = Math.round(coverage * 255)
      }
      glyphContext.putImageData(image, 0, 0)
      const box = interpolatedBox(
        glyphBox(sourceLayout, sourceGlyph, compiled.source),
        glyphBox(targetLayout, targetGlyph, compiled.target),
        progress,
      )
      context.drawImage(glyphCanvas, box.left, box.top, box.width, box.height)
    }
    frameVersionRef.current += 1
    canvas.dataset.fontMorphSdfFrame = `${locale}:${progress}:${frameVersionRef.current}`
  }, [data, locale, sample, progress, layoutVersion])

  return (
    <main className="demo" data-demo-status={data && sample ? 'ready' : error ? 'error' : 'loading'}>
      <header className="demo-header">
        <div><p className="eyebrow">font-morph · distance-field experiment</p><h1>Controlled transition</h1></div>
        <label className="locale-control" htmlFor="locale"><span>Language</span>
          <select id="locale" value={locale} onChange={(event) => { setProgress(0); setLocale(event.target.value) }}>
            {Object.entries(data?.samples ?? {}).map(([code, value]) => <option key={code} value={code}>{value.label}</option>)}
          </select>
        </label>
      </header>
      <section ref={stageRef} className="stage" aria-label={`${sample?.label ?? ''} font morph`}>
        <div className="endpoint-row">
          <span ref={sourceRef} className="endpoint source-endpoint" data-demo-endpoint="source" lang={locale}>{sample?.text}</span>
          <span ref={targetRef} className="endpoint target-endpoint" data-demo-endpoint="target" lang={locale}>{sample?.text}</span>
        </div>
        <canvas ref={canvasRef} className="sdf-layer" data-font-morph-sdf="" />
        <div className="endpoint-caption source-caption">{sample?.sourceLabel}</div>
        <div className="endpoint-caption target-caption">{sample?.targetLabel}</div>
      </section>
      <div className="progress-control">
        <div className="progress-label"><label htmlFor="progress">Progress</label><output htmlFor="progress">{Math.round(progress * 100)}%</output></div>
        <input id="progress" type="range" min="0" max="1000" step="1" value={Math.round(progress * 1000)} disabled={!data || !sample} onChange={(event) => setProgress(Number(event.target.value) / 1000)} />
      </div>
      <p className="status" role="status">{error || (!data ? 'Loading distance fields…' : 'Experimental signed-distance renderer')}</p>
    </main>
  )
}
