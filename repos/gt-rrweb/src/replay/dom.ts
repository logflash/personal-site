const SVG_NS = 'http://www.w3.org/2000/svg';

type SvgChild = {
  tag: 'circle' | 'path';
  attrs: Record<string, string>;
};

function htmlElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  id?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (id) element.id = id;
  if (className) element.className = className;
  return element;
}

function svgElement(
  doc: Document,
  attrs: Record<string, string>,
  children: readonly SvgChild[],
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
  for (const child of children) {
    const node = doc.createElementNS(SVG_NS, child.tag);
    for (const [name, value] of Object.entries(child.attrs)) node.setAttribute(name, value);
    svg.appendChild(node);
  }
  return svg;
}

function icon(
  doc: Document,
  children: readonly SvgChild[],
  fill = 'none',
): SVGSVGElement {
  return svgElement(
    doc,
    {
      viewBox: '0 0 24 24',
      fill,
      ...(fill === 'none'
        ? {
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }
        : {}),
    },
    children,
  );
}

export function createSunIcon(doc: Document): SVGSVGElement {
  return icon(doc, [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4' } },
    ...[
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41',
    ].map((d) => ({ tag: 'path' as const, attrs: { d } })),
  ]);
}

export function createMoonIcon(doc: Document): SVGSVGElement {
  return icon(doc, [{ tag: 'path', attrs: { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' } }]);
}

export function createFullscreenEnterIcon(doc: Document): SVGSVGElement {
  return icon(
    doc,
    [
      'M8 3H5a2 2 0 0 0-2 2v3',
      'M21 8V5a2 2 0 0 0-2-2h-3',
      'M3 16v3a2 2 0 0 0 2 2h3',
      'M16 21h3a2 2 0 0 0 2-2v-3',
    ].map((d) => ({ tag: 'path' as const, attrs: { d } })),
  );
}

export function createFullscreenExitIcon(doc: Document): SVGSVGElement {
  return icon(
    doc,
    [
      'M8 3v3a2 2 0 0 1-2 2H3',
      'M21 8h-3a2 2 0 0 1-2-2V3',
      'M3 16h3a2 2 0 0 1 2 2v3',
      'M16 21v-3a2 2 0 0 1 2-2h3',
    ].map((d) => ({ tag: 'path' as const, attrs: { d } })),
  );
}

export function createPlayIcon(doc: Document): SVGSVGElement {
  return icon(doc, [{ tag: 'path', attrs: { d: 'M8 5v14l11-7z' } }], 'currentColor');
}

export function createPauseIcon(doc: Document): SVGSVGElement {
  return icon(
    doc,
    [{ tag: 'path', attrs: { d: 'M7 5h3.4v14H7zM13.6 5H17v14h-3.4z' } }],
    'currentColor',
  );
}

export function createDownloadIcon(doc: Document): SVGSVGElement {
  return icon(
    doc,
    ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'].map((d) => ({
      tag: 'path' as const,
      attrs: { d },
    })),
  );
}

/** Builds the fixed player chrome without parsing an HTML string. */
export function createReplayerDom(doc: Document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const stage = htmlElement(doc, 'div', 'stage');
  const scaler = htmlElement(doc, 'div', 'scaler');
  scaler.append(htmlElement(doc, 'div', 'player'), htmlElement(doc, 'div', 'director'));
  stage.appendChild(scaler);
  stage.appendChild(htmlElement(doc, 'div', 'shield'));

  const playpause = htmlElement(doc, 'div', 'playpause');
  const initialPlayButton = htmlElement(doc, 'span', undefined, 'pp-btn');
  initialPlayButton.appendChild(createPlayIcon(doc));
  playpause.appendChild(initialPlayButton);
  stage.append(playpause, htmlElement(doc, 'div', 'recframe'));

  const scrubber = htmlElement(doc, 'div', 'scrubber');
  const scrubrow = htmlElement(doc, 'div', 'scrubrow');
  const time = htmlElement(doc, 'span', 'time');
  time.textContent = '0:00 / 0:00';
  const hud = htmlElement(doc, 'div', 'hud');
  hud.appendChild(htmlElement(doc, 'span', 'flags'));
  hud.appendChild(htmlElement(doc, 'span', 'localeSep', 'hudsep'));
  for (const [id, label] of [
    ['downloadJson', 'Download replay JSON'],
    ['darkToggle', 'Toggle theme'],
    ['fsToggle', 'Toggle full screen'],
  ] as const) {
    const button = htmlElement(doc, 'button', id);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    hud.appendChild(button);
  }
  scrubrow.append(time, hud);

  const trackrow = htmlElement(doc, 'div', 'trackrow');
  const playButton = htmlElement(doc, 'button', 'playBtn');
  playButton.type = 'button';
  playButton.setAttribute('aria-label', 'Play/pause');
  const track = htmlElement(doc, 'div', 'track');
  track.append(htmlElement(doc, 'div', 'played'), htmlElement(doc, 'div', 'thumb'));
  trackrow.append(playButton, track);
  scrubber.append(scrubrow, trackrow);
  stage.appendChild(scrubber);

  const effects = htmlElement(doc, 'div', 'fx');
  const cursor = htmlElement(doc, 'div', 'cursor');
  const cursorSvg = svgElement(
    doc,
    { width: '22', height: '22', viewBox: '0 0 22 22', 'aria-hidden': 'true' },
    [
      {
        tag: 'path',
        attrs: {
          d: 'M1 1 L1 16.5 L5.2 12.3 L8.3 19 L10.8 17.9 L7.7 11.2 L13.5 11.2 Z',
          fill: '#ffffff',
          stroke: '#141414',
          'stroke-width': '1.3',
          'stroke-linejoin': 'round',
        },
      },
    ],
  );
  cursor.appendChild(cursorSvg);
  effects.appendChild(cursor);
  stage.appendChild(effects);
  fragment.appendChild(stage);
  return fragment;
}
