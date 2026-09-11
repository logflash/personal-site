import type { eventWithTime } from '@rrweb/types'
import type { GTReplayerFrame } from 'gt-rrweb/replay'

export const SKILL_CARD_RECORD_EVENT = 'resume-skill-card:record'
export const SKILL_CARD_ANIMATION_KIND = 'skill-card'
export const SKILL_CARD_ANIMATION_MS = 420

export interface SkillCardAnimationPayload {
  version: 1
  kind: typeof SKILL_CARD_ANIMATION_KIND
  key: string
  open: boolean
  duration: number
}

type SerializedNode = {
  id?: number
  type?: number
  attributes?: Record<string, unknown>
  childNodes?: SerializedNode[]
}

type MutationData = {
  source?: number
  attributes?: Array<{ id?: number; attributes?: Record<string, unknown> }>
  adds?: Array<{ node?: SerializedNode }>
}

type IndexedSkillAnimation = {
  event: eventWithTime
  payload: SkillCardAnimationPayload
  start: number
  end: number
}

const animationIndex = new WeakMap<eventWithTime[], IndexedSkillAnimation[]>()

function classList(node: SerializedNode) {
  return String(node.attributes?.class ?? '').split(/\s+/)
}

function titleHash(node: SerializedNode): string | undefined {
  if (classList(node).includes('resume-skill-card-title')) {
    const hash = node.attributes?.['data-_gt-hash']
    if (typeof hash === 'string') return hash
  }
  for (const child of node.childNodes ?? []) {
    const hash = titleHash(child)
    if (hash) return hash
  }
  return undefined
}

function collectCardKeys(node: SerializedNode | undefined, output: Map<number, string>) {
  if (!node) return
  if (typeof node.id === 'number' && classList(node).includes('resume-skill-card')) {
    const direct = node.attributes?.['data-gt-skill-card']
    const key = typeof direct === 'string' ? direct : titleHash(node)
    if (key) output.set(node.id, key)
  }
  for (const child of node.childNodes ?? []) collectCardKeys(child, output)
}

function skillPayload(event: eventWithTime): SkillCardAnimationPayload | null {
  const custom = event as eventWithTime & {
    data?: { tag?: string; payload?: Partial<SkillCardAnimationPayload> }
  }
  const payload = custom.data?.payload
  return custom.type === 5 &&
    custom.data?.tag === 'gt-animation' &&
    payload?.version === 1 &&
    payload.kind === SKILL_CARD_ANIMATION_KIND &&
    typeof payload.key === 'string' &&
    typeof payload.open === 'boolean' &&
    Number.isFinite(payload.duration) &&
    (payload.duration ?? 0) > 0
    ? (payload as SkillCardAnimationPayload)
    : null
}

/**
 * Record one compact semantic event instead of serializing fixed-position clones
 * or animation frames. The replay resolves every endpoint in its active locale.
 */
export function emitSkillCardAnimation(key: string, open: boolean) {
  window.dispatchEvent(
    new CustomEvent<SkillCardAnimationPayload>(SKILL_CARD_RECORD_EVENT, {
      detail: {
        version: 1,
        kind: SKILL_CARD_ANIMATION_KIND,
        key,
        open,
        duration: SKILL_CARD_ANIMATION_MS,
      },
    }),
  )
}

/**
 * Recordings captured before the semantic event existed still contain the card's
 * data-open mutation. Add an equivalent event immediately before that mutation so
 * the deterministic timeline can reserve and reconstruct the animation.
 */
export function upgradeLegacySkillCardAnimations(events: eventWithTime[]): eventWithTime[] {
  const cardKeys = new Map<number, string>()
  for (const event of events) {
    if (event.type === 2) {
      collectCardKeys((event.data as unknown as { node?: SerializedNode }).node, cardKeys)
    } else if (event.type === 3) {
      const data = event.data as unknown as MutationData
      for (const addition of data.adds ?? []) collectCardKeys(addition.node, cardKeys)
    }
  }

  const existing = events.flatMap((event) => {
    const payload = skillPayload(event)
    return payload ? [{ timestamp: event.timestamp, payload }] : []
  })
  let changed = false
  const output: eventWithTime[] = []
  for (const event of events) {
    if (event.type === 3) {
      const data = event.data as unknown as MutationData
      if (data.source === 0) {
        for (const change of data.attributes ?? []) {
          if (
            typeof change.id !== 'number' ||
            !Object.prototype.hasOwnProperty.call(change.attributes, 'data-open')
          ) {
            continue
          }
          const key = cardKeys.get(change.id)
          if (!key) continue
          const open = change.attributes?.['data-open'] != null
          const alreadyRecorded = existing.some(
            (candidate) =>
              candidate.payload.key === key &&
              candidate.payload.open === open &&
              Math.abs(candidate.timestamp - event.timestamp) <= 100,
          )
          if (alreadyRecorded) continue
          output.push({
            type: 5,
            timestamp: event.timestamp,
            data: {
              tag: 'gt-animation',
              payload: {
                version: 1,
                kind: SKILL_CARD_ANIMATION_KIND,
                key,
                open,
                duration: SKILL_CARD_ANIMATION_MS,
              } satisfies SkillCardAnimationPayload,
            },
          } as eventWithTime)
          changed = true
        }
      }
    }
    output.push(event)
  }
  return changed ? output : events
}

function indexAnimations(events: eventWithTime[]) {
  let indexed = animationIndex.get(events)
  if (indexed) return indexed
  const firstTimestamp = events[0]?.timestamp ?? 0
  indexed = []
  for (const event of events) {
    const payload = skillPayload(event)
    if (!payload) continue
    const start = event.timestamp - firstTimestamp
    indexed.push({ event, payload, start, end: start + payload.duration })
  }
  animationIndex.set(events, indexed)
  return indexed
}

function animationAt(frame: GTReplayerFrame) {
  const animations = indexAnimations(frame.events)
  for (let index = animations.length - 1; index >= 0; index -= 1) {
    const animation = animations[index]
    if (frame.time >= animation.start && frame.time < animation.end) return animation
  }
  return null
}

function transitionEase(progress: number) {
  // Cubic-bezier(0.22, 1, 0.36, 1), solved deterministically from its x coordinate.
  const sample = (time: number, first: number, second: number) => {
    const inverse = 1 - time
    return 3 * inverse * inverse * time * first + 3 * inverse * time * time * second + time ** 3
  }
  const slope = (time: number, first: number, second: number) =>
    3 * (1 - time) ** 2 * first +
    6 * (1 - time) * time * (second - first) +
    3 * time ** 2 * (1 - second)
  const x = Math.max(0, Math.min(1, progress))
  let time = x
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const derivative = slope(time, 0.22, 0.36)
    if (Math.abs(derivative) < 1e-7) break
    time = Math.max(0, Math.min(1, time - (sample(time, 0.22, 0.36) - x) / derivative))
  }
  return sample(time, 1, 1)
}

function findCard(document: Document, key: string): HTMLElement | null {
  const direct = [...document.querySelectorAll<HTMLElement>('[data-gt-skill-card]')].find(
    (card) => card.dataset.gtSkillCard === key,
  )
  if (direct) return direct
  return (
    [...document.querySelectorAll<HTMLElement>('.resume-skill-card-title')]
      .find((heading) => heading.dataset._gtHash === key)
      ?.closest<HTMLElement>('.resume-skill-card') ?? null
  )
}

type ReplayState = {
  event: eventWithTime
  locale?: string
  document: Document
  content: HTMLElement
  sourceDots: HTMLElement[]
  destinationDots: HTMLElement[]
  clones: HTMLElement[]
  layer: HTMLElement
  targetHeight: number
  contentStyle: string
  dotStyles: Map<HTMLElement, string>
  lastTime: number
}

export function createSkillCardReplayDirector() {
  let state: ReplayState | null = null

  const clear = () => {
    if (!state) return
    state.content.style.cssText = state.contentStyle
    for (const [dot, cssText] of state.dotStyles) dot.style.cssText = cssText
    state.layer.remove()
    state = null
  }

  const mount = (frame: GTReplayerFrame, active: IndexedSkillAnimation): ReplayState | null => {
    const document = frame.document
    if (!document) return null
    const card = findCard(document, active.payload.key)
    const content = card?.querySelector<HTMLElement>('.resume-skill-card-content')
    const summary = card?.querySelector<HTMLElement>('.resume-skill-card-dots')
    const details = card?.querySelector<HTMLElement>('.resume-skill-card-details')
    if (!card || !content || !summary || !details) return null
    const compactDots = [...summary.querySelectorAll<HTMLElement>('.lang-dot')]
    const expandedDots = [...details.querySelectorAll<HTMLElement>('.lang-dot')]
    const sourceDots = active.payload.open ? compactDots : expandedDots
    const destinationDots = active.payload.open ? expandedDots : compactDots
    if (!sourceDots.length || sourceDots.length !== destinationDots.length) return null

    const layer = document.createElement('div')
    layer.className = 'resume-skill-replay-layer'
    layer.dataset.skillCardKey = active.payload.key
    Object.assign(layer.style, {
      position: 'fixed',
      zIndex: '1000',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      overflow: 'visible',
      pointerEvents: 'none',
    })
    const clones = sourceDots.map((dot) => {
      const clone = document.createElement('span')
      clone.className = 'resume-skill-replay-dot'
      Object.assign(clone.style, {
        position: 'fixed',
        display: 'block',
        borderRadius: '50%',
        pointerEvents: 'none',
      })
      clone.style.setProperty('background', getComputedStyle(dot).backgroundColor, 'important')
      layer.append(clone)
      return clone
    })
    document.body.append(layer)

    const dotStyles = new Map<HTMLElement, string>()
    for (const dot of new Set([...sourceDots, ...destinationDots])) {
      dotStyles.set(dot, dot.style.cssText)
      dot.style.setProperty('opacity', '0', 'important')
    }
    const contentStyle = content.style.cssText
    const targetHeight = content.scrollHeight
    content.style.setProperty('overflow', 'hidden', 'important')
    content.style.setProperty('visibility', 'visible', 'important')

    return {
      event: active.event,
      locale: frame.locale,
      document,
      content,
      sourceDots,
      destinationDots,
      clones,
      layer,
      targetHeight,
      contentStyle,
      dotStyles,
      lastTime: frame.time,
    }
  }

  return (frame: GTReplayerFrame) => {
    if (!frame.document || !Number.isFinite(frame.time)) {
      clear()
      return
    }
    if (state && frame.time < state.lastTime) clear()
    const active = animationAt(frame)
    if (!active) {
      clear()
      return
    }
    if (
      !state ||
      state.event !== active.event ||
      state.document !== frame.document ||
      state.locale !== frame.locale ||
      !state.layer.isConnected
    ) {
      clear()
      state = mount(frame, active)
      if (!state) return
    }

    state.lastTime = frame.time
    const linear = Math.max(0, Math.min(1, (frame.time - active.start) / active.payload.duration))
    const progress = transitionEase(linear)
    const heightProgress = active.payload.open ? progress : 1 - progress
    state.content.style.setProperty(
      'height',
      `${state.targetHeight * heightProgress}px`,
      'important',
    )

    for (let index = 0; index < state.clones.length; index += 1) {
      const source = state.sourceDots[index].getBoundingClientRect()
      const destination = state.destinationDots[index].getBoundingClientRect()
      const clone = state.clones[index]
      const interpolate = (from: number, to: number) => from + (to - from) * progress
      clone.style.left = `${interpolate(source.left, destination.left)}px`
      clone.style.top = `${interpolate(source.top, destination.top)}px`
      clone.style.width = `${interpolate(source.width, destination.width)}px`
      clone.style.height = `${interpolate(source.height, destination.height)}px`
    }
  }
}
