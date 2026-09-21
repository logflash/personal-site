import { EventType, IncrementalSource, type eventWithTime } from '@rrweb/types';

type SerializedNodeLike = {
  type?: unknown;
  tagName?: unknown;
  attributes?: unknown;
  childNodes?: unknown;
};

type EventDataLike = Record<string, unknown>;

function elementNonce(element: Element | null): string {
  if (!element) return '';
  const propertyNonce = 'nonce' in element ? String(element.nonce ?? '') : '';
  return propertyNonce.trim() || element.getAttribute('nonce')?.trim() || '';
}

/** Find the active document nonce without depending on a host framework. */
export function documentCspNonce(doc: Document): string {
  const nonceElement = doc.querySelector('script[nonce], style[nonce]');
  const nonce = elementNonce(nonceElement);
  if (nonce) return nonce;

  return (
    doc
      .querySelector<HTMLMetaElement>(
        'meta[property="csp-nonce"], meta[name="csp-nonce"]',
      )
      ?.content.trim() ?? ''
  );
}

/** Apply the host document's nonce before a stylesheet enters a live document. */
export function nonceStyleElement(
  style: HTMLStyleElement,
  nonceDocument: Document = style.ownerDocument,
): HTMLStyleElement {
  const nonce = documentCspNonce(nonceDocument);
  if (nonce) style.nonce = nonce;
  return style;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonceSerializedNode(node: unknown, nonce: string): unknown {
  if (!isRecord(node)) return node;
  const serialized = node as SerializedNodeLike;
  let childNodes = serialized.childNodes;
  let childrenChanged = false;
  if (Array.isArray(childNodes)) {
    const nextChildren = childNodes.map((child) => {
      const next = nonceSerializedNode(child, nonce);
      if (next !== child) childrenChanged = true;
      return next;
    });
    if (childrenChanged) childNodes = nextChildren;
  }

  const attributes = isRecord(serialized.attributes) ? serialized.attributes : null;
  const tagName =
    typeof serialized.tagName === 'string' ? serialized.tagName.toLowerCase() : '';
  // rrweb reconstructs links carrying `_cssText` as inline style elements.
  const becomesStyle =
    serialized.type === 2 &&
    (tagName === 'style' || (tagName === 'link' && typeof attributes?._cssText === 'string'));
  const nonceChanged = becomesStyle && attributes?.nonce !== nonce;

  if (!childrenChanged && !nonceChanged) return node;
  return {
    ...node,
    ...(childrenChanged ? { childNodes } : {}),
    ...(nonceChanged ? { attributes: { ...attributes, nonce } } : {}),
  };
}

/**
 * Return a replay timeline whose serialized styles use the current response nonce.
 * Copy-on-write keeps the downloadable recording bundle byte-for-byte untouched.
 */
export function withCspStyleNonces(
  events: readonly eventWithTime[],
  nonce: string,
): eventWithTime[] {
  if (!nonce) return [...events];

  return events.map((event) => {
    const data = event.data as EventDataLike;
    if (event.type === EventType.FullSnapshot) {
      const node = nonceSerializedNode(data.node, nonce);
      return node === data.node ? event : ({ ...event, data: { ...data, node } } as eventWithTime);
    }

    if (
      event.type !== EventType.IncrementalSnapshot ||
      data.source !== IncrementalSource.Mutation ||
      !Array.isArray(data.adds)
    )
      return event;
    let changed = false;
    const adds = data.adds.map((addition) => {
      if (!isRecord(addition)) return addition;
      const node = nonceSerializedNode(addition.node, nonce);
      if (node === addition.node) return addition;
      changed = true;
      return { ...addition, node };
    });
    return changed ? ({ ...event, data: { ...data, adds } } as eventWithTime) : event;
  });
}
