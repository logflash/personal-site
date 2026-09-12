import { Replayer as RRWebReplayer } from '@rrweb/replay';
import type { eventWithTime } from '@rrweb/types';
import morphdomDefault from 'morphdom';

import type { LocaleTextOverlay } from '../types';
import {
  REPLAY_EVENT as EVT,
  REPLAY_SOURCE as SRC,
  analyzePointerInput,
  buildScrollTracks,
  clampScrollPosition,
  collectDirectedClicks,
  compressTimeline,
  detectDoubleClicks,
  firstScrollTimeBetween,
  incrementalData,
  markScrollBurstStarts,
  projectPointIntoRect,
  rectAtScrollPosition,
  replaceNativeScrollEvents,
  scrollDeltaToRevealRect,
  scrollPositionAt,
  type DirectedClick,
} from './director';
import { GT_REPLAYER_CLASS, REPLAYER_CSS, REPLAYER_HTML } from './styles';

/**
 * The recording a replayer plays. Structurally a {@link RecorderBundle}: the rrweb
 * event stream plus the harvested per-locale text overlay. `locales` is SOURCE
 * FIRST (locales[0] is the recorded/source render); `overlay` maps locale → (rrweb
 * node id → translated text). Both are optional — with neither, the replay just
 * renders the recorded source with no flag switcher.
 */
export type GTReplayerBundle = {
  events: eventWithTime[];
  locales?: readonly string[];
  overlay?: LocaleTextOverlay;
};

export type GTReplayerFrame = {
  /** Current replay time in milliseconds, after gt-rrweb timeline direction. */
  time: number;
  /** The reconstructed rrweb document, or null while the player is being destroyed. */
  document: Document | null;
  /** Locale currently rendered by the replay. */
  locale?: string;
  /** Directed event timeline used by the visible and seek engines. */
  events: eventWithTime[];
  /**
   * Safe, unsandboxed layer root aligned to the visible recording viewport.
   * Semantic directors should render canvas/WebGL effects here rather than in
   * rrweb's script-disabled replay iframe, where dynamically drawn canvas
   * backing stores do not reliably composite.
   */
  overlayRoot: HTMLElement | null;
};

export type GTReplayerOptions = {
  /**
   * Locale to render on mount. Defaults to the source locale (locales[0]) — i.e.
   * the recording as captured. Must be one of `bundle.locales` to take effect.
   */
  initialLocale?: string;
  /**
   * Show the in-player locale switcher (the flag buttons) and allow switching
   * locales mid-replay. Default true. Set false for locale-specific embeds (e.g.
   * a docs page that should only ever show one locale).
   */
  switchLocalesAllowed?: boolean;
  /** Deterministic per-frame extension point for semantic replay effects. */
  onFrame?: (frame: GTReplayerFrame) => void | {
    /** Skip an invisible semantic animation's remaining empty timeline. */
    advanceTo: number;
  };
  /**
   * Debug: drag-and-drop a recording JSON file onto the player to hot-swap the
   * replay with it (a bundle `{events, locales?, overlay?}` or a raw rrweb events
   * array). A non-JSON / non-recording file fails gracefully with a notice.
   * Default false.
   */
  debug?: boolean;
};

/** Handle returned by {@link createGTReplayer}; call `destroy()` to tear it down. */
export type GTReplayerHandle = {
  destroy(): void;
};

// ---- local structural types ---------------------------------------------- //
// The rrweb event/serialized-node payloads are loosely shaped for our walks; we
// read them through these minimal types (cast at the boundary) rather than fighting
// rrweb's discriminated unions per access.

type SNode = {
  type?: number;
  id?: number;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SNode[];
};
type IncrementalData = {
  source?: number;
  type?: number;
  pointerType?: number;
  adds?: Array<{ node?: SNode }>;
  removes?: Array<{ id?: number }>;
  texts?: Array<{ id?: number; value?: string }>;
  attributes?: unknown[];
  x?: number;
  y?: number;
  id?: number;
};
type FullSnapshotData = { node?: SNode };
type MetaData = { width?: number; height?: number };

/** rrweb serialized-DOM mirror (id <-> live node), as much of it as we use. */
type ReplayMirror = {
  getId(node: Node): number;
  getNode(id: number): Node | null;
};

/**
 * The rrweb Replayer surface we drive. Declared locally (and the instance is cast to
 * it) so this module doesn't couple to @rrweb/replay's exact published types — we
 * only rely on the runtime class existing.
 */
type ReplayerInstance = {
  iframe: HTMLIFrameElement;
  play(timeOffset?: number): void;
  pause(timeOffset?: number): void;
  getCurrentTime(): number;
  getMetaData(): { totalTime: number };
  getMirror(): ReplayMirror;
  on(event: string, handler: (...args: unknown[]) => void): void;
  hoverElements: (...args: unknown[]) => void;
};
type ReplayerCtor = new (
  events: eventWithTime[],
  config: Record<string, unknown>,
) => ReplayerInstance;
type MorphdomFn = (
  from: Node,
  to: Node,
  opts?: { onBeforeElUpdated?: (fromEl: Element, toEl: Element) => boolean },
) => void;

const RR = RRWebReplayer as unknown as ReplayerCtor;
const morphdom = morphdomDefault as unknown as MorphdomFn;

const STYLE_ID = 'gt-replayer-styles';

function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = REPLAYER_CSS;
  doc.head.appendChild(style);
}

/** One mounted player. createGTReplayer wraps this to add debug hot-swap. */
function createPlayerInstance(
  container: HTMLElement,
  bundle: GTReplayerBundle,
  options: GTReplayerOptions,
): GTReplayerHandle {
  const ownerDoc = container.ownerDocument ?? document;
  container.classList.add(GT_REPLAYER_CLASS);
  container.innerHTML = REPLAYER_HTML;
  injectStyles(ownerDoc);

  function must<T extends HTMLElement>(sel: string): T {
    const el = container.querySelector(sel);
    if (!el) throw new Error(`gt-replayer: missing element ${sel}`);
    return el as unknown as T;
  }

  // Rendered in-player only — shouldn't also write to the
  // host app's console for a condition the player already surfaces.
  const showError = (msg: string): void => {
    const s = container.querySelector('#stage');
    if (s)
      s.insertAdjacentHTML(
        'beforeend',
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e88;font:14px system-ui">' +
          msg +
          '</div>',
      );
  };

  let events = bundle.events;
  if (!Array.isArray(events) || events.length < 2) {
    showError('recording has too few events');
    return { destroy() {} };
  }

  // Teardown state, declared up front: setup code below (the ResizeObserver, the
  // reveal-gate poll) reads/writes these synchronously, so they must be initialized
  // before that runs — not at the bottom next to destroy() (that's a TDZ crash).
  let destroyed = false;
  let resizeObs: ResizeObserver | null = null;
  let warmTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- timeline reader helpers ------------------------------------------- //
  const incr = (e: eventWithTime): IncrementalData | null =>
    incrementalData(e) as IncrementalData | null;
  const { usesTouchControls, isDirectedClick } = analyzePointerInput(events);
  const scrollBurstStarts = markScrollBurstStarts(events);

  // Timeline pacing for a crisp demo. Two goals:
  //  • Page transitions are INSTANT — the load/render wait between a click and the
  //    DOM it produces collapses to ~nothing, so the destination page appears the
  //    moment the cursor clicks (the recorded ~1–2s SPA latency is dead weight).
  //  • The cursor still glides — a dwell is kept BEFORE each click cluster (the
  //    recorded idle before the user moved to the next target) so there's time to
  //    animate the pointer to it and for the viewer to read the page.
  // A "click" is really a mousedown/up/click burst, so the dwell is applied before
  // the START of that burst, never inside it. Fine timing WITHIN an action (e.g.
  // typing) is preserved. Clicks are recomputed from this timeline, so the cursor
  // stays in sync.
  const hiddenClicks = detectDoubleClicks(events, isDirectedClick);
  events = compressTimeline(events, hiddenClicks, isDirectedClick);
  const t0 = events[0].timestamp;
  const metaEvt = events.find((e) => e.type === EVT.Meta);
  const metaData = metaEvt ? (metaEvt.data as unknown as MetaData) : null;
  const recW = (metaData && metaData.width) || window.innerWidth;
  const recH = (metaData && metaData.height) || window.innerHeight;

  const scrollTracks = buildScrollTracks(events, t0, scrollBurstStarts);
  const clicks = collectDirectedClicks(events, t0, isDirectedClick);
  type SyntheticScrollCorrection = {
    click: DirectedClick;
    trackId: number;
    x: number;
    y: number;
    start: number;
    releaseStart: number | null;
    releaseEnd: number | null;
  };
  const syntheticScrolls: SyntheticScrollCorrection[] = [];
  const preparedVisibilityClicks = new Set<DirectedClick>();
  const visibleEvents = replaceNativeScrollEvents(events);

  const replayer = new RR(visibleEvents, {
    root: must('#player'),
    speed: 1,
    skipInactive: false,
    mouseTail: false,
    showWarning: false,
    // rrweb renders blocked elements (operator chrome, class `rr-block`) as
    // placeholder boxes filled with `background: currentColor`; under dark mode that
    // inherited color is near-white, painting the content area white. Force those
    // placeholders transparent inside the replay iframe.
    insertStyleRules: [
      '.rr-block { background: transparent !important; border: 0 !important; }',
      // rrweb replays recorded Focus events by programmatically .focus()-ing the
      // target; inside the iframe that counts as keyboard focus, so the app's
      // :focus-visible ring paints on every clicked control. Passive demo → strip it.
      ':focus, :focus-visible { outline: none !important; box-shadow: none !important; }',
      // Replayed CSS animations/transitions don't track the (compressed) mutation
      // timeline, so fading overlays flash half-opacity frames. Force everything to
      // 0s so overlays snap straight to their end state.
      '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }',
      // Radix keeps a dismissed overlay in the DOM for its exit animation
      // (data-state="closed"); with the fade gone that would linger as a solid dim.
      // Hide closed-state elements outright so a dismiss is instant.
      '[data-state="closed"] { display: none !important; }',
      // Replaced elements (img/svg) sized ONLY by a Tailwind `size-*` class blow up
      // during a backward-seek/scrub: the rebuild paints a frame BEFORE the external
      // stylesheet re-applies, so each falls back to its intrinsic size. Pin every
      // size-* token in the recording so nothing can blow up mid-scrub.
      'img.size-3, svg.size-3 { width: 0.75rem !important; height: 0.75rem !important; }',
      'img.size-3\\.5, svg.size-3\\.5 { width: 0.875rem !important; height: 0.875rem !important; }',
      'img.size-4, svg.size-4 { width: 1rem !important; height: 1rem !important; }',
      'img.size-5, svg.size-5 { width: 1.25rem !important; height: 1.25rem !important; }',
      'img.size-8, svg.size-8 { width: 2rem !important; height: 2rem !important; }',
      'img.size-10, svg.size-10 { width: 2.5rem !important; height: 2.5rem !important; }',
    ],
  });

  // Disable rrweb's :hover reproduction. On each recorded interaction rrweb adds a
  // `:hover` class up the hovered element's ancestor chain, which activates the app's
  // rewritten `.\:hover` styles (e.g. a nav item's white outline ring) — so a hover
  // highlight trails the recorded pointer. We synthesize our own cursor and want no
  // hover state applied, so make it a no-op.
  replayer.hoverElements = () => {};

  // ---- no first-paint flash ---------------------------------------------- //
  // The Replayer builds+paints its first snapshot on construction, but the app's
  // stylesheet loads async. Elements sized ONLY by CSS briefly render at their
  // intrinsic (large) size, then snap smaller once the CSS applies. So keep the
  // replay hidden until its stylesheets (then fonts) have loaded, then fade in.
  // Hiding runs synchronously here, before the browser's first paint. Re-armed on
  // every full-snapshot rebuild (initial + restart/seek) so restarts don't flash.
  const scalerEl = must('#scaler');
  // Whether the stage is currently shown. The director cursor is an overlay OUTSIDE
  // the scaler, so hiding the scaler alone leaves it visible; the frame loop reads
  // this to hide the cursor while the stage is gated (see below).
  let stageRevealed = false;
  function hideReplay(): void {
    scalerEl.style.transition = 'none';
    scalerEl.style.opacity = '0';
    stageRevealed = false;
  }
  function revealReplay(): void {
    scalerEl.style.transition = 'opacity 160ms ease';
    scalerEl.style.opacity = '1';
    stageRevealed = true;
  }
  function whenReplayStyled(cb: () => void): void {
    // POLL (rather than listen for load events) until the rebuilt snapshot is in the
    // iframe AND every stylesheet <link> has applied (`l.sheet`). A load-event
    // listener races: the sheet can finish before we attach, or the Replayer
    // re-creates the <link> mid-build, so the event is missed. Capped so a
    // stuck/missing sheet can't blank the stage forever.
    const started = performance.now();
    const attempt = (): void => {
      if (destroyed) return;
      const doc = replayer.iframe && replayer.iframe.contentDocument;
      const bodyReady = doc && doc.body && doc.body.childNodes.length;
      const links = doc
        ? [...doc.querySelectorAll('link[rel="stylesheet"]')]
        : [];
      const stylesReady =
        bodyReady && links.every((l) => (l as HTMLLinkElement).sheet);
      if (!stylesReady && performance.now() - started < 1500) {
        requestAnimationFrame(attempt);
        return;
      }
      // then let fonts settle so text doesn't reflow right after reveal
      const fonts = doc && doc.fonts;
      if (fonts && fonts.ready) fonts.ready.then(cb, cb);
      else cb();
    };
    attempt();
  }
  // One-shot: gate ONLY the initial build (the first-paint flash). Later rebuilds — a
  // backward seek/scrub rebuilds from the single full snapshot — happen with the
  // stylesheet already applied, so hiding again would just flicker while scrubbing.
  // The timeline + director cursor start only once the stage is actually revealed.
  let autoStarted = false;
  function beginPlaybackOnce(): void {
    if (autoStarted || destroyed) return;
    autoStarted = true;
    // Resolve the capture frame + crop to it. The framed element's box can take a few
    // frames to settle after the snapshot is in, so poll fit() until it's valid.
    const frameT0 = performance.now();
    const tryFrame = (): void => {
      if (destroyed || frameBox) return;
      fit();
      if (!frameBox && performance.now() - frameT0 < 3000)
        requestAnimationFrame(tryFrame);
    };
    tryFrame();
    startLoop(); // director cursor + scrubber loop (cursor was hidden until now)
    replayer.play(0); // start the timeline from 0, in sync with the reveal
    // Warm the hidden scrub engine while idle so the first drag is instant.
    warmTimer = setTimeout(() => {
      if (destroyed) return;
      try {
        ensureEngine();
        if (engine) engine.pause(0);
      } catch {}
    }, 1200);
  }
  let revealGateArmed = true;
  function gateReveal(): void {
    if (!revealGateArmed || destroyed) return;
    revealGateArmed = false;
    hideReplay();
    let shown = false;
    const show = (): void => {
      if (shown || destroyed) return;
      shown = true;
      revealReplay();
      captureAppCss(); // CSS is loaded now → snapshot it for the rebuild bridge
      applyThemeMode(); // now CSS is loaded → stage bg can match the recording
      beginPlaybackOnce(); // start playback + cursor together with the reveal
    };
    whenReplayStyled(show);
    setTimeout(show, 2000); // safety net — never leave the stage blank
  }
  gateReveal();
  replayer.on('fullsnapshot-rebuilded', gateReveal);

  // ---- theme OPTION (dark toggle) ---------------------------------------- //
  // Dark mode is an in-player OPTION, re-asserted on the replay <html> across rrweb
  // rebuilds. The toggle drives whatever theme mechanism the RECORDING itself uses —
  // a `.dark` class (Tailwind/shadcn) or a `data-theme` / `data-mode` attribute —
  // detected from the captured <html>, so it works for any GT site, not just one.
  const THEME_ATTRS = ['data-theme', 'data-mode', 'data-color-mode'] as const;
  type ThemeSwitch = {
    recordedDark: boolean;
    setDark: (html: HTMLElement, dark: boolean) => void;
  };
  function detectThemeSwitch(evs: eventWithTime[]): ThemeSwitch {
    const fs = evs.find((e) => e.type === EVT.FullSnapshot);
    const findHtml = (n?: SNode): SNode | null => {
      if (!n) return null;
      if (n.type === 2 && n.tagName === 'html') return n;
      for (const c of n.childNodes || []) {
        const found = findHtml(c);
        if (found) return found;
      }
      return null;
    };
    const attrs: Record<string, unknown> =
      (fs &&
        findHtml((fs.data as unknown as FullSnapshotData).node)?.attributes) ||
      {};
    // Attribute-based theming (data-theme="dark"|"light", …). The recorded value is
    // the "light" value unless it's already "dark".
    const themeAttr = THEME_ATTRS.find((a) => typeof attrs[a] === 'string');
    if (themeAttr) {
      const recorded = String(attrs[themeAttr]);
      const lightVal = recorded === 'dark' ? 'light' : recorded;
      return {
        recordedDark: recorded === 'dark',
        setDark: (html, dark) =>
          html.setAttribute(themeAttr, dark ? 'dark' : lightVal),
      };
    }
    // Class-based theming (`.dark` on <html>) — the default/Tailwind convention.
    const cls = typeof attrs.class === 'string' ? attrs.class : '';
    return {
      recordedDark: /(^|\s)dark(\s|$)/.test(cls),
      setDark: (html, dark) => html.classList.toggle('dark', dark),
    };
  }
  const themeSwitch = detectThemeSwitch(events);
  let darkMode = themeSwitch.recordedDark;
  // Last successfully-detected recording background, per theme. A backward scrub
  // fires 'fullsnapshot-rebuilded' → applyThemeMode() while the DOM is mid-rebuild,
  // when the body momentarily reads a transparent bg. Without a cache we'd fall back
  // to the dark stage color and flash the stage black for that frame. Remember the
  // good value and keep it when detection fails.
  const lastRecBg: { light: string; dark: string } = { light: '', dark: '' };
  function applyThemeMode(): void {
    const rdoc = replayer.iframe && replayer.iframe.contentDocument;
    const html = rdoc && rdoc.documentElement;
    if (!rdoc || !html) return;
    const dark = darkMode;
    // Re-tone the PLAYER chrome (HUD/scrubber/buttons) for the active theme — the
    // stage below takes the recording's own bg, so dark-tuned chrome looks wrong on a
    // light recording.
    container.classList.toggle('chrome-light', !dark);
    themeSwitch.setDark(html, dark);
    const scheme = dark ? 'dark' : 'light';
    if (html.style.colorScheme !== scheme) html.style.colorScheme = scheme;
    // Match the stage (letterbox) AND the replay box (scaler) background to the
    // recording's OWN background so (a) the centered replay has no visible seam, and
    // (b) a torn/empty rebuild frame during a scrub shows the page color, not black.
    let recBg = '';
    for (const el of [rdoc.body, html]) {
      if (!el) continue;
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
        recBg = c;
        break;
      }
    }
    const key = dark ? 'dark' : 'light';
    if (recBg) lastRecBg[key] = recBg; // cache good detections per theme
    // Prefer a fresh read, else the last good one for this theme, else the default
    // stage bg. Never fall straight to the dark default once we've seen a real bg.
    const bg = recBg || lastRecBg[key] || '#0f0f10';
    stageEl.style.background = bg;
    scalerEl.style.background = bg;
  }

  // ---- FOUC bridge across rebuilds (the real "jumpy scrub" fix) ---------- //
  // A backward seek makes rrweb rebuild the snapshot, re-creating the replay iframe's
  // <link rel=stylesheet>. A <link> re-applies ASYNC, so the FIRST frame after every
  // rebuild is UNSTYLED. During a scrub a seek fires every frame, so that unstyled
  // frame is ALL you ever see → torn content = "jumpy". Bridge it: once the app CSS
  // has loaded, snapshot every readable rule into a string and re-inject it as an
  // INLINE <style> (parses synchronously) at the top of <head> on EVERY rebuild.
  let appCssText = '';
  function captureAppCss(): void {
    if (appCssText) return;
    const doc = replayer.iframe && replayer.iframe.contentDocument;
    if (!doc) return;
    const rules: string[] = [];
    for (const ss of [...doc.styleSheets]) {
      if (ss.ownerNode && (ss.ownerNode as Element).id === '__gt-css-bridge')
        continue;
      let cr: CSSRuleList;
      try {
        cr = ss.cssRules;
      } catch {
        continue; // cross-origin sheet — not readable, skip
      }
      for (const rule of cr) rules.push(rule.cssText);
    }
    if (rules.length < 80) return; // not fully loaded yet — retry next rebuild
    appCssText = rules.join('\n');
  }
  function bridgeStyles(): void {
    const doc = replayer.iframe && replayer.iframe.contentDocument;
    if (!doc || !doc.head) return;
    if (!appCssText) captureAppCss();
    if (!appCssText) return;
    if (doc.getElementById('__gt-css-bridge')) return; // already bridged this doc
    const bridge = doc.createElement('style');
    bridge.id = '__gt-css-bridge';
    bridge.textContent = appCssText;
    doc.head.insertBefore(bridge, doc.head.firstChild);
  }

  // Theme toggle in the HUD (sun when dark → go light, moon when light → go dark).
  const darkToggle = must<HTMLButtonElement>('#darkToggle');
  const SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  function syncDarkIcon(): void {
    // Show the icon for the mode you'll switch TO (dark now → Sun → light).
    darkToggle.innerHTML = darkMode ? SUN_SVG : MOON_SVG;
    darkToggle.title = darkMode
      ? 'Switch to light mode'
      : 'Switch to dark mode';
  }
  syncDarkIcon();
  darkToggle.onclick = () => {
    darkMode = !darkMode;
    syncDarkIcon();
    applyThemeMode();
    scrubber.classList.toggle('dark', darkMode); // bar: white↔black
  };

  // ---- full-screen mode -------------------------------------------------- //
  // Fill the viewport via a CSS class (works everywhere, incl. iOS Safari where the
  // Fullscreen API can't fullscreen a <div>), and additionally request native
  // fullscreen where supported for an immersive, chrome-hidden view.
  const fsToggle = must<HTMLButtonElement>('#fsToggle');
  const FS_ENTER_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const FS_EXIT_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
  const inFullscreen = (): boolean => container.classList.contains('gt-fs');
  function syncFsIcon(): void {
    const on = inFullscreen();
    fsToggle.innerHTML = on ? FS_EXIT_SVG : FS_ENTER_SVG;
    fsToggle.title = on ? 'Exit full screen' : 'Full screen';
  }
  function setFullscreen(on: boolean): void {
    container.classList.toggle('gt-fs', on);
    syncFsIcon();
    fit(); // the stage size changed drastically → re-fit the crop into it
    if (on) {
      if (container.requestFullscreen)
        container.requestFullscreen().catch(() => {});
    } else if (ownerDoc.fullscreenElement && ownerDoc.exitFullscreen) {
      ownerDoc.exitFullscreen().catch(() => {});
    }
  }
  syncFsIcon();
  fsToggle.onclick = () => setFullscreen(!inFullscreen());
  // Collapse back when native fullscreen is exited via Esc / a system gesture.
  const onFsChange = (): void => {
    if (!ownerDoc.fullscreenElement && inFullscreen()) {
      container.classList.remove('gt-fs');
      syncFsIcon();
      fit();
    }
  };
  ownerDoc.addEventListener('fullscreenchange', onFsChange);

  // ---- per-locale text overlay ------------------------------------------- //
  // The bundle carries `locales` (source first) and a node-id-keyed overlay
  // (locale → { rrwebId: text }). Switching locale swaps text in place on the live
  // replay DOM with no rebuild — only translated text changes.
  //
  // When the structured `locales`/`overlay` fields are absent — e.g. a raw
  // events-only export, or a debug drag-drop of one — fall back to the copies the
  // recorder embeds in the stream itself as custom events (`gt-locales`,
  // `gt-i18n`), so such files still replay localized rather than source-only.
  const embedded = readEmbedded(bundle.events);
  const OVERLAYS: LocaleTextOverlay = bundle.overlay || embedded.overlay || {};
  const localeList = bundle.locales
    ? [...bundle.locales]
    : embedded.locales
      ? [...embedded.locales]
      : [];
  const demoLocales =
    localeList.length > 0
      ? { locales: localeList, sourceLocale: localeList[0] }
      : null;
  const SOURCE_LOCALE = demoLocales ? demoLocales.sourceLocale : null;
  function overlayFor(loc: string): Record<number, string> | null {
    return OVERLAYS[loc] || null;
  }
  let ACTIVE_LOCALE = options.initialLocale || SOURCE_LOCALE;
  let overlay: Record<number, string> | null = null;
  if (
    ACTIVE_LOCALE &&
    ACTIVE_LOCALE !== SOURCE_LOCALE &&
    demoLocales &&
    demoLocales.locales.indexOf(ACTIVE_LOCALE) !== -1
  ) {
    overlay = overlayFor(ACTIVE_LOCALE);
  }
  const localeValues = demoLocales ? new Set(demoLocales.locales) : null;
  function syncLocaleControls(
    rootNode: Node | Document | null,
    locale = ACTIVE_LOCALE,
  ): void {
    if (!rootNode || !locale || !localeValues || !localeValues.has(locale))
      return;
    const root =
      rootNode.nodeType === Node.DOCUMENT_NODE
        ? (rootNode as Document).documentElement
        : rootNode;
    if (!root) return;
    const selects: HTMLSelectElement[] = [];
    if (
      root.nodeType === Node.ELEMENT_NODE &&
      (root as Element).localName === 'select'
    ) {
      selects.push(root as HTMLSelectElement);
    }
    if ('querySelectorAll' in root) {
      selects.push(...root.querySelectorAll<HTMLSelectElement>('select'));
    }
    for (const select of selects) {
      if (select.multiple) continue;
      const selectOptions = [...select.options];
      const values = new Set(selectOptions.map((option) => option.value));
      if (![...localeValues].every((value) => values.has(value))) continue;
      const selectedIndex = selectOptions.findIndex(
        (option) => option.value === locale,
      );
      if (selectedIndex < 0) continue;
      for (let index = 0; index < selectOptions.length; index += 1) {
        const option = selectOptions[index];
        const selected = index === selectedIndex;
        option.selected = selected;
        if (selected) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      }
      select.selectedIndex = selectedIndex;
      select.value = locale;
    }
  }
  const mirror = replayer.getMirror();
  const appliedScroll = new Map<number, { x: number; y: number }>();

  function syntheticScrollFactor(
    correction: SyntheticScrollCorrection,
    time: number,
  ): number {
    const smooth = (progress: number) => {
      const clamped = Math.max(0, Math.min(1, progress));
      return clamped * clamped * (3 - 2 * clamped);
    };
    if (time < correction.start) return 0;
    if (time < correction.click.t) {
      return smooth(
        (time - correction.start) /
          Math.max(1, correction.click.t - correction.start),
      );
    }
    if (
      correction.releaseStart == null ||
      correction.releaseEnd == null ||
      time <= correction.releaseStart
    )
      return 1;
    if (time >= correction.releaseEnd) return 0;
    return (
      1 -
      smooth(
        (time - correction.releaseStart) /
          Math.max(1, correction.releaseEnd - correction.releaseStart),
      )
    );
  }

  function syntheticScrollOffset(trackId: number, time: number) {
    let x = 0;
    let y = 0;
    for (const correction of syntheticScrolls) {
      if (correction.trackId !== trackId) continue;
      const factor = syntheticScrollFactor(correction, time);
      x += correction.x * factor;
      y += correction.y * factor;
    }
    return { x, y };
  }

  function resetSyntheticScrolls(): void {
    syntheticScrolls.length = 0;
    preparedVisibilityClicks.clear();
  }

  function visibleScrollNode(id: number): Element | null {
    const node = mirror?.getNode(id);
    if (!node) return null;
    if (node.nodeType === Node.DOCUMENT_NODE) {
      const doc = node as Document;
      return doc.scrollingElement || doc.documentElement || doc.body;
    }
    return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  }

  function achievableScrollPosition(scroller: Element, position: { x: number; y: number }) {
    return clampScrollPosition(position, {
      x: scroller.scrollWidth - scroller.clientWidth,
      y: scroller.scrollHeight - scroller.clientHeight,
    });
  }

  function applyDirectedScroll(time: number, force = false): void {
    for (const track of scrollTracks.values()) {
      const position = scrollPositionAt(track, time, clicks, easeLogistic);
      if (!position) continue;
      const scroller = visibleScrollNode(track.id);
      if (!scroller) continue;
      const correction = syntheticScrollOffset(track.id, time);
      const { x, y } = achievableScrollPosition(scroller, {
        x: position.x + correction.x,
        y: position.y + correction.y,
      });
      const previous = appliedScroll.get(track.id);
      if (
        !force &&
        previous &&
        Math.abs(previous.x - x) < 0.05 &&
        Math.abs(previous.y - y) < 0.05
      ) {
        continue;
      }
      scroller.scrollLeft = x;
      scroller.scrollTop = y;
      appliedScroll.set(track.id, { x, y });
    }
  }

  // id -> last SOURCE text recorded for that node. The harvest keyed each target off
  // this text, so we substitute ONLY while the live node still shows it — a dynamic
  // node whose value has since changed stays source (never a stale localization).
  function collectRecordedSource(evs: eventWithTime[]): Map<number, string> {
    const map = new Map<number, string>();
    const walk = (n?: SNode): void => {
      if (!n) return;
      if (
        n.type === 3 &&
        typeof n.id === 'number' &&
        typeof n.textContent === 'string' &&
        n.textContent.trim()
      )
        map.set(n.id, n.textContent);
      (n.childNodes || []).forEach(walk);
    };
    for (const e of evs) {
      if (e.type === EVT.FullSnapshot)
        walk((e.data as unknown as FullSnapshotData).node);
      const d = incr(e);
      if (d && d.source === SRC.Mutation) {
        (d.adds || []).forEach((a) => walk(a.node));
        (d.texts || []).forEach((tx) => {
          if (
            typeof tx.id === 'number' &&
            typeof tx.value === 'string' &&
            tx.value.trim()
          )
            map.set(tx.id, tx.value);
        });
      }
    }
    return map;
  }
  // Always available (even when the initial locale is source) so in-place locale
  // switching can revert swapped nodes back to their recorded source.
  const RECORDED_SRC = collectRecordedSource(events);
  const swapped = new Set<number>(); // rrweb node ids we've text-swapped (for revert)

  // Apply translations by rewriting text nodes as rrweb renders them, via a
  // MutationObserver — ONCE per change, not every frame — so we never fight rrweb's
  // own updates. Re-translating a node's target text is a no-op (targets aren't
  // source keys), so no loop.
  function translateTextNode(node: Node, m?: ReplayMirror | null): void {
    const mir = m || mirror;
    if (!mir || !overlay) return;
    const id = mir.getId(node);
    if (id == null || id < 0) return;
    const tgt = overlay[id];
    if (tgt === undefined) return;
    const src = RECORDED_SRC.get(id);
    // Only substitute while the node still shows its recorded source text; otherwise
    // (dynamic value changed) leave it as source.
    if (src !== undefined && (node.textContent || '').trim() !== src.trim())
      return;
    if (node.textContent !== tgt) node.textContent = tgt;
    swapped.add(id); // track for in-place locale switch revert
  }
  function translateTree(rootNode: Node, m?: ReplayMirror | null): void {
    if (!rootNode) return;
    const doc = rootNode.ownerDocument || (rootNode as unknown as Document);
    const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    nodes.forEach((n) => translateTextNode(n, m));
  }
  let translateObserver: MutationObserver | null = null;
  function attachTranslator(): void {
    const doc = replayer.iframe && replayer.iframe.contentDocument;
    if (!doc || !doc.body) return;
    if (ACTIVE_LOCALE) doc.documentElement.lang = ACTIVE_LOCALE;
    translateTree(doc.body);
    syncLocaleControls(doc.body);
    if (translateObserver) translateObserver.disconnect();
    translateObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') {
          if (r.target.nodeType === 3) translateTextNode(r.target);
        } else {
          r.addedNodes.forEach((nn) => {
            if (nn.nodeType === 3) translateTextNode(nn);
            else if (nn.nodeType === 1) {
              translateTree(nn);
              syncLocaleControls(nn);
            }
          });
          syncLocaleControls(r.target);
        }
      }
    });
    translateObserver.observe(doc.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
  // rrweb replaces the document on each FullSnapshot rebuild (incl. restart), so
  // (re)attach then; plus an initial attach once the iframe is ready. Re-inject the
  // app CSS synchronously on every rebuild BEFORE the theme/paint so the first
  // post-rebuild frame is styled (kills the scrub FOUC), then re-assert the theme.
  replayer.on('fullsnapshot-rebuilded', attachTranslator);
  replayer.on('fullsnapshot-rebuilded', bridgeStyles);
  replayer.on('fullsnapshot-rebuilded', applyThemeMode);
  (function initAttach(): void {
    if (destroyed) return;
    const doc = replayer.iframe && replayer.iframe.contentDocument;
    if (doc && doc.body && doc.body.childNodes.length) attachTranslator();
    else requestAnimationFrame(initAttach);
  })();

  // ---- no-rebuild scrub via a hidden "engine" replayer + morphdom -------- //
  // rrweb must REBUILD the whole document on a backward seek (it can't reverse
  // mutations); that repaints everything and re-loads the web fonts (FOUT). Fix: once
  // the user starts scrubbing, FREEZE the visible replayer and drive the display from
  // a SEPARATE hidden "engine" replayer — computing each target frame there, then
  // MORPHDOM only the differences into the (never-rebuilt) visible iframe. Unchanged
  // components keep their exact DOM node → no repaint; the visible document is never
  // rebuilt → fonts stay loaded → no FOUT.
  let engine: ReplayerInstance | null = null;
  let engineMirror: ReplayMirror | null = null;
  let engineMode = false; // true once the scrubber is touched; visible replayer dormant
  const engineHost = ownerDoc.createElement('div');
  engineHost.setAttribute('aria-hidden', 'true');
  engineHost.style.cssText =
    'position:fixed;left:-100000px;top:0;width:' +
    recW +
    'px;height:' +
    recH +
    'px;opacity:0;pointer-events:none;overflow:hidden;';
  container.appendChild(engineHost);
  function ensureEngine(): ReplayerInstance {
    if (engine) return engine;
    engine = new RR(events, {
      root: engineHost,
      speed: 1,
      skipInactive: false,
      mouseTail: false,
      showWarning: false,
      insertStyleRules: [
        '.rr-block { background: transparent !important; border: 0 !important; }',
      ],
    });
    engine.hoverElements = () => {}; // no rrweb hover reproduction (see above)
    engineMirror = engine.getMirror();
    return engine;
  }
  function morphVisibleFromEngine(atT: number): void {
    const ed = engine && engine.iframe && engine.iframe.contentDocument;
    const vd = replayer.iframe && replayer.iframe.contentDocument;
    if (!ed || !ed.body || !vd || !vd.body) return;
    if (ACTIVE_LOCALE) ed.documentElement.lang = ACTIVE_LOCALE;
    translateTree(ed.body, engineMirror);
    syncLocaleControls(ed.body);
    // Copy the engine body into the visible document first, then morph the visible
    // body to match it — reusing every unchanged node in place. onBeforeElUpdated
    // returns false for equal subtrees so morphdom skips them entirely.
    const copy = vd.importNode(ed.body, true);
    morphdom(vd.body, copy, {
      onBeforeElUpdated: (fromEl, toEl) => !fromEl.isEqualNode(toEl),
    });
    syncLocaleControls(vd.body);
    const eh = ed.documentElement;
    const vh = vd.documentElement;
    if (eh && vh && vh.getAttribute('class') !== eh.getAttribute('class'))
      vh.setAttribute('class', eh.getAttribute('class') || ''); // carry dark class
    applyThemeMode();
    appliedScroll.clear();
    applyDirectedScroll(atT, true);
  }
  // Enter engine mode: freeze the visible replayer (no-arg pause = stop the timer
  // WITHOUT a rebuild) and stop its translate observer (morphdom supplies
  // already-localized content), then hand rendering to engine+morphdom.
  function enterEngineMode(atT: number): void {
    if (engineMode) return;
    engineMode = true;
    ensureEngine();
    try {
      replayer.pause();
    } catch {}
    if (translateObserver) translateObserver.disconnect();
    if (engine) engine.pause(atT);
    morphVisibleFromEngine(atT);
  }
  function engineScrubTo(t: number): void {
    ensureEngine();
    if (engine) engine.pause(t);
    morphVisibleFromEngine(t);
  }
  // Current time from whichever clock is live: the engine while scrubbing (or paused
  // after a scrub), else the visible replayer (normal forward playback).
  function curTime(): number {
    return engineMode && engine
      ? engine.getCurrentTime()
      : replayer.getCurrentTime();
  }

  const stageEl = must('#stage');
  const scaler = scalerEl;
  const director = must('#director');
  const fx = must('#fx');
  const cursor = must('#cursor');
  const recframe = must('#recframe');
  const scrubber = must('#scrubber');
  // Swallow wheel/touch on the replay shield so nothing scrolls — the recorded page
  // behaves like a video. (Controls sit above the shield.)
  const shield = must('#shield');
  shield.addEventListener('wheel', (e) => e.preventDefault(), {
    passive: false,
  });
  shield.addEventListener('touchmove', (e) => e.preventDefault(), {
    passive: false,
  });

  // ---- crop to the recorder's capture frame (mini-player) ---------------- //
  // The recorder reflows the content into a centered box of a fixed aspect,
  // marked by html.gt-recording + a <style id="gt-rrweb-frame"> whose rule targets
  // the framed element. Measure that element's box (recorded-viewport coords, which
  // are constant) and crop the replay to it, so the player shows just the framed
  // content at the capture aspect — a mini-player — not the whole viewport + walls.
  function resolveFrameBox(): {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null {
    try {
      const doc = replayer.iframe && replayer.iframe.contentDocument;
      const st =
        doc &&
        (doc.getElementById('gt-rrweb-frame') as HTMLStyleElement | null);
      if (!doc || !st) return null;
      let selectorText = '';
      if (st.sheet && st.sheet.cssRules.length)
        selectorText =
          (st.sheet.cssRules[0] as CSSStyleRule).selectorText || '';
      else selectorText = (st.textContent || '').split('{')[0];
      const sel = selectorText
        .split(',')
        .map((s) => s.replace(/html\.gt-recording/g, '').trim())
        .filter(Boolean)
        .join(',');
      const el = sel ? doc.querySelector(sel) : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      // Reject a not-yet-settled measurement: a real capture frame is SMALLER than
      // the recorded viewport in at least one dimension and never larger than it.
      if (r.width > recW + 1 || r.height > recH + 1) return null;
      if (r.width >= recW - 1 && r.height >= recH - 1) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    } catch {
      return null;
    }
  }
  let frameBox: { x: number; y: number; w: number; h: number } | null = null;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  function fit(): void {
    // Resolve the capture frame once (its box is constant in recorded coords). Retry
    // each fit until the iframe's snapshot is in — then size the player to that aspect.
    if (!frameBox) {
      frameBox = resolveFrameBox();
      if (frameBox) {
        // Size the player to the capture aspect via the STAGE (a flex child) with a
        // definite width — not the flex-column root, whose height would then be
        // content-driven and collapse. Root height follows the stage.
        stageEl.style.flex = 'none';
        stageEl.style.width = '100%';
        stageEl.style.aspectRatio = `${frameBox.w} / ${frameBox.h}`;
        container.style.height = 'auto';
      }
    }
    const cropX = frameBox ? frameBox.x : 0;
    const cropY = frameBox ? frameBox.y : 0;
    const cropW = frameBox ? frameBox.w : recW;
    const cropH = frameBox ? frameBox.h : recH;

    const stageW = stageEl.clientWidth || window.innerWidth;
    const stageH = stageEl.clientHeight || window.innerHeight;
    // Contain-fit the CROP box (capture frame, or the whole viewport when unframed)
    // into the stage, then center it; the viewport outside the crop is clipped by
    // #stage (overflow:hidden). Unframed never upscales past 1:1.
    scale = Math.min(stageW / cropW, stageH / cropH);
    if (!frameBox) scale = Math.min(scale, 1);
    const boxW = cropW * scale;
    const boxH = cropH * scale;
    const centerX = Math.max(0, (stageW - boxW) / 2);
    const centerY = Math.max(0, (stageH - boxH) / 2);
    // Offset the (full-viewport) scaler so the crop box lands in the centered box.
    offsetX = centerX - cropX * scale;
    offsetY = centerY - cropY * scale;
    scaler.style.left = offsetX + 'px';
    scaler.style.top = offsetY + 'px';
    scaler.style.transform = 'scale(' + scale + ')';
    // Directors use normalized capture-frame coordinates. Keeping their root
    // inside the scaler makes it share the replay's crop, scale, and clipping
    // without granting scripts to rrweb's protected iframe.
    director.style.left = cropX + 'px';
    director.style.top = cropY + 'px';
    director.style.width = cropW + 'px';
    director.style.height = cropH + 'px';
    // Shield + controls hug the visible crop box.
    shield.style.left = centerX + 'px';
    shield.style.top = centerY + 'px';
    shield.style.width = boxW + 'px';
    shield.style.height = boxH + 'px';
    recframe.style.left = centerX + 'px';
    recframe.style.top = centerY + 'px';
    recframe.style.width = boxW + 'px';
    recframe.style.height = boxH + 'px';
    scrubber.style.left = centerX + 14 + 'px';
    scrubber.style.width = boxW - 28 + 'px';
    scrubber.style.bottom = stageH - (centerY + boxH) + 12 + 'px';
  }
  fit();
  window.addEventListener('resize', fit);
  // Re-fit whenever the stage actually changes size. The first fit() runs before the
  // controls bar reaches its final height, which shrinks the stage by a few px.
  if (window.ResizeObserver) {
    resizeObs = new ResizeObserver(() => fit());
    resizeObs.observe(stageEl);
  }

  // ----- director: eased glide between clicks, ripple on click ----- //
  // The cursor eases across the glide interval (see positionAt) — no speed constant,
  // duration clamp, or per-frame cap — so it can never freeze-then-dart (a teleport);
  // the ease itself supplies the read-time pauses near each click.
  //
  // LOGISTIC (sigmoid) easing → the SPEED profile is a slow → fast → slow bell (the
  // derivative of an S-curve): the cursor accelerates out of the previous click,
  // cruises through the middle, and decelerates onto the next. The half-range sets the
  // steepness; ±4 keeps the fast middle gentler than an ease-in-out cubic, so even the
  // longest move stays a visible glide rather than a dart.
  const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
  const LOGISTIC_RANGE = 4; // sigmoid half-range — steepness of the slow-fast-slow S
  const L_LO = logistic(-LOGISTIC_RANGE);
  const L_HI = logistic(LOGISTIC_RANGE);
  const easeLogistic = (p: number): number =>
    (logistic((p - 0.5) * 2 * LOGISTIC_RANGE) - L_LO) / (L_HI - L_LO);
  let prevT = 0;

  function cursorBounds() {
    return frameBox
      ? {
          left: frameBox.x,
          top: frameBox.y,
          right: frameBox.x + frameBox.w,
          bottom: frameBox.y + frameBox.h,
        }
      : { left: 0, top: 0, right: recW, bottom: recH };
  }

  function isCursorPointVisible(point: { x: number; y: number }): boolean {
    const bounds = cursorBounds();
    return (
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    );
  }

  function constrainCursorPosition(point: { x: number; y: number }) {
    const bounds = cursorBounds();
    return {
      x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
      y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
    };
  }

  function clickTargetElement(click: DirectedClick): Element | null {
    const node = mirror && click.id != null ? mirror.getNode(click.id) : null;
    const element: Element | null = node
      ? node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : null
      : null;
    return (
      element?.closest(
        'button, summary, a[href], input, select, textarea, [role="button"], [role="link"]',
      ) ??
      element ??
      null
    );
  }

  function prepareClickVisibility(time: number): boolean {
    let added = false;
    for (let index = 0; index < clicks.length; index += 1) {
      const click = clicks[index];
      const previous = clicks[index - 1];
      const start = Math.max(previous?.t ?? 0, click.t - 600);
      if (time < start || time > click.t + 220) continue;
      if (preparedVisibilityClicks.has(click)) continue;
      preparedVisibilityClicks.add(click);

      const element = clickTargetElement(click);
      const initialRect = element?.getBoundingClientRect();
      if (!element || !initialRect?.width || !initialRect.height) continue;

      const containingTracks = [...scrollTracks.values()].filter((track) =>
        visibleScrollNode(track.id)?.contains(element),
      );
      if (!containingTracks.length) continue;

      let clickRect = {
        left: initialRect.left,
        top: initialRect.top,
        right: initialRect.right,
        bottom: initialRect.bottom,
      };
      for (const track of containingTracks) {
        const scroller = visibleScrollNode(track.id);
        const recorded = scrollPositionAt(track, click.t, clicks, easeLogistic);
        if (!scroller || !recorded) continue;
        const existing = syntheticScrollOffset(track.id, click.t);
        const target = achievableScrollPosition(scroller, {
          x: recorded.x + existing.x,
          y: recorded.y + existing.y,
        });
        clickRect = rectAtScrollPosition(
          clickRect,
          { x: scroller.scrollLeft, y: scroller.scrollTop },
          target,
        );
      }

      const delta = scrollDeltaToRevealRect(clickRect, cursorBounds(), 12);
      if (Math.abs(delta.x) < 0.05 && Math.abs(delta.y) < 0.05) continue;

      // Prefer the closest recorded scroll container that can absorb the required
      // axis. This preserves the captured page scroll unless the translated target
      // is genuinely unreachable at the recorded position.
      let chosen: { track: (typeof containingTracks)[number]; scroller: Element } | null = null;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const track = containingTracks.find(
          (candidate) => visibleScrollNode(candidate.id) === ancestor,
        );
        if (!track) continue;
        const scroller = visibleScrollNode(track.id);
        if (!scroller) continue;
        if (
          (Math.abs(delta.y) >= 0.05 && scroller.scrollHeight > scroller.clientHeight) ||
          (Math.abs(delta.x) >= 0.05 && scroller.scrollWidth > scroller.clientWidth)
        ) {
          chosen = { track, scroller };
          break;
        }
      }
      if (!chosen) {
        const track = containingTracks[0];
        const scroller = visibleScrollNode(track.id);
        if (scroller) chosen = { track, scroller };
      }
      if (!chosen) continue;

      const recorded = scrollPositionAt(chosen.track, click.t, clicks, easeLogistic);
      if (!recorded) continue;
      const existing = syntheticScrollOffset(chosen.track.id, click.t);
      const requestedTarget = {
        x: recorded.x + existing.x,
        y: recorded.y + existing.y,
      };
      const currentTarget = achievableScrollPosition(chosen.scroller, requestedTarget);
      const desired = achievableScrollPosition(chosen.scroller, {
        x: currentTarget.x + delta.x,
        y: currentTarget.y + delta.y,
      });
      // Corrections are added to the original requested position before the
      // shared clamp, so include any overshoot already removed by that clamp.
      const x = desired.x - requestedTarget.x;
      const y = desired.y - requestedTarget.y;
      if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) continue;

      const nextPoint = chosen.track.points.find((point) => point.t > click.t);
      const nextPointAfter = nextPoint
        ? chosen.track.points.find(
            (point) => point.t > nextPoint.t && point.burst === nextPoint.burst,
          )
        : undefined;
      syntheticScrolls.push({
        click,
        trackId: chosen.track.id,
        x,
        y,
        start,
        releaseStart: nextPoint?.t ?? null,
        releaseEnd: nextPoint
          ? Math.max(nextPoint.t + 1, nextPointAfter?.t ?? nextPoint.t + 450)
          : null,
      });
      added = true;
    }
    return added;
  }

  // Resolve the target at its click timestamp, rather than wherever the target
  // happens to be during the current frame. This keeps cursor waypoints stable
  // while their elements scroll, while still adapting to locale and layout changes.
  function liveXY(click: DirectedClick): { x: number; y: number } {
    try {
      const element = clickTargetElement(click);
      if (element?.getBoundingClientRect) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          let clickRect = {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          };
          for (const track of scrollTracks.values()) {
            const scroller = visibleScrollNode(track.id);
            if (!scroller || !scroller.contains(element)) continue;
            let position = scrollPositionAt(
              track,
              click.t,
              clicks,
              easeLogistic,
            );
            if (!position && track.points[0] && click.t < track.points[0].t) {
              position = { x: 0, y: 0 };
            }
            if (!position) continue;
            const correction = syntheticScrollOffset(track.id, click.t);
            const target = achievableScrollPosition(scroller, {
              x: position.x + correction.x,
              y: position.y + correction.y,
            });
            clickRect = rectAtScrollPosition(
              clickRect,
              { x: scroller.scrollLeft, y: scroller.scrollTop },
              target,
            );
          }
          const bounds = cursorBounds();
          const visibleRect = {
            left: Math.max(clickRect.left, bounds.left),
            top: Math.max(clickRect.top, bounds.top),
            right: Math.min(clickRect.right, bounds.right),
            bottom: Math.min(clickRect.bottom, bounds.bottom),
          };
          if (
            visibleRect.right >= visibleRect.left &&
            visibleRect.bottom >= visibleRect.top
          ) {
            return projectPointIntoRect(click, visibleRect);
          }
          return constrainCursorPosition(
            projectPointIntoRect(click, clickRect),
          );
        }
      }
    } catch {
      // A removed/unresolvable target falls back to its recorded coordinates.
    }
    return constrainCursorPosition({ x: click.x, y: click.y });
  }

  const ring = ownerDoc.createElement('div');
  ring.className = 'gt-ring';
  ring.style.display = 'none';
  fx.appendChild(ring);

  function renderClickEffects(time: number): void {
    let activeRing: { click: DirectedClick; age: number } | null = null;
    let pressing = false;
    const rippleDuration = usesTouchControls ? 420 : 220;
    for (const click of clicks) {
      if (!isCursorPointVisible(click)) continue;
      const age = time - click.t;
      if (age >= 0 && age < 90) pressing = true;
      if (age >= 0 && age < rippleDuration) activeRing = { click, age };
    }
    cursor.classList.toggle('clicking', pressing && !usesTouchControls);
    if (!activeRing) {
      ring.style.display = 'none';
      return;
    }
    const position = liveXY(activeRing.click);
    const progress = Math.max(0, Math.min(1, activeRing.age / rippleDuration));
    const eased = 1 - Math.pow(1 - progress, 3);
    const minimumSize = usesTouchControls ? 22 : 10;
    const maximumSize = usesTouchControls ? 108 : 64;
    const size = minimumSize + (maximumSize - minimumSize) * eased;
    ring.style.display = 'block';
    ring.style.left = offsetX + position.x * scale + 'px';
    ring.style.top = offsetY + position.y * scale + 'px';
    ring.style.width = size + 'px';
    ring.style.height = size + 'px';
    ring.style.borderWidth = usesTouchControls ? '3px' : '2px';
    ring.style.background = usesTouchControls
      ? 'rgba(37, 120, 255, 0.18)'
      : 'transparent';
    ring.style.boxShadow = usesTouchControls
      ? '0 0 0 4px rgba(37, 120, 255, 0.12)'
      : 'none';
    ring.style.opacity = String((usesTouchControls ? 1 : 0.85) * (1 - eased));
    ring.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  }

  const mutationTimes: number[] = [];
  for (const event of events) {
    const data = incr(event);
    if (
      data?.source === SRC.Mutation &&
      (data.adds?.length || data.removes?.length || data.texts?.length)
    ) {
      mutationTimes.push(event.timestamp - t0);
    }
  }

  function glideAt(
    points: DirectedClick[],
    index: number,
  ): number {
    const click = points[index];
    if (index === 0) return click.t;
    const from = points[index - 1].t;
    const firstScroll = firstScrollTimeBetween(scrollTracks, from, click.t);
    if (firstScroll != null) return firstScroll;
    let end = from;
    for (const mutationTime of mutationTimes) {
      if (
        mutationTime > from &&
        mutationTime <= click.t &&
        mutationTime > end
      ) {
        end = mutationTime;
      }
    }
    return end;
  }

  function positionAt(time: number): { x: number; y: number } | null {
    const visibleClicks = clicks.filter(isCursorPointVisible);
    if (!visibleClicks.length) return null;
    const index = visibleClicks.findIndex((click) => click.t >= time);
    if (index === -1) return liveXY(visibleClicks[visibleClicks.length - 1]);
    if (index === 0) {
      return liveXY(visibleClicks[0]);
    }
    const next = visibleClicks[index];
    const from = liveXY(visibleClicks[index - 1]);
    const start = glideAt(visibleClicks, index);
    if (time <= start) return from;
    const to = liveXY(next);
    const span = next.t - start;
    const progress = span > 0 ? (time - start) / span : 1;
    const eased = easeLogistic(Math.min(1, Math.max(0, progress)));
    return {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    };
  }
  // ----- scrubber: seek + YouTube-style auto-hide ----- //
  const track = must('#track');
  const played = must('#played');
  const thumb = must('#thumb');
  const timeEl = must('#time');
  const totalTime =
    (replayer.getMetaData && replayer.getMetaData().totalTime) ||
    events[events.length - 1].timestamp - events[0].timestamp;
  const fmtTime = (ms: number): string => {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const totalStr = fmtTime(totalTime);
  let lastPct = -1;
  let lastSec = -1;
  function updateScrub(t: number): void {
    const frac = totalTime ? Math.max(0, Math.min(1, t / totalTime)) : 0;
    const pct = Math.round(frac * 1000) / 10;
    if (pct !== lastPct) {
      lastPct = pct;
      played.style.width = pct + '%';
      thumb.style.left = pct + '%';
    }
    const sec = Math.round(t / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      timeEl.textContent = fmtTime(t) + ' / ' + totalStr;
    }
  }
  updateScrub(0);
  scrubber.classList.toggle('dark', darkMode); // bar color follows theme

  // Auto-hide after a beat of stillness; reveal on any pointer activity over the
  // stage (and stay while hovering the bar or mid-drag).
  let dragging = false;
  // Scrubbing coalescer: a pointermove fires ~120x/s, but each backward
  // engine.pause(t) rebuilds. A pointermove only records the target time
  // (pendingSeek) + moves the bar instantly; the actual rebuild is applied at most
  // ONCE per animation frame in frame(), always to the latest target.
  let pendingSeek: number | null = null;
  let lastAppliedSeek: number | null = null;
  let overScrubber = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  const playpause = must('#playpause');
  const playBtn = must<HTMLButtonElement>('#playBtn');
  const PLAY_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
  function setPaused(p: boolean): void {
    paused = p;
    playpause.classList.toggle('show', p);
    playBtn.innerHTML = p ? PLAY_SVG : PAUSE_SVG; // button shows the action
  }
  setPaused(false); // init: playing → show the pause icon
  function showControls(): void {
    scrubber.classList.add('show');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // keep the controls up while paused / hovering / dragging
      if (!dragging && !overScrubber && !paused)
        scrubber.classList.remove('show');
    }, 2200);
  }
  stageEl.addEventListener('mousemove', showControls);
  stageEl.addEventListener('mouseleave', () => {
    if (!dragging) scrubber.classList.remove('show');
  });
  scrubber.addEventListener('mouseenter', () => {
    overScrubber = true;
    showControls();
  });
  scrubber.addEventListener('mouseleave', () => {
    overScrubber = false;
    showControls();
  });
  showControls(); // flash it once on load so it's discoverable

  // Seeking is stateless: reset the last transformed cursor coordinates so a
  // backward or forward jump renders exactly like that timestamp on first arrival.
  function syncVisualTime(time: number): void {
    prevT = time;
    lastCurX = null;
    lastCurY = null;
    appliedScroll.clear();
  }
  function timeFromClientX(x: number): number {
    const r = track.getBoundingClientRect();
    const frac = r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0;
    return frac * totalTime;
  }
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    startLoop(); // in case we were paused — the cursor should follow the scrub
    try {
      track.setPointerCapture(e.pointerId);
    } catch {}
    const t = timeFromClientX(e.clientX);
    // Enter engine mode (freeze the visible replayer, drive via morphdom) on the first
    // touch; thereafter just seek the engine. Either way NO visible-doc rebuild.
    if (!engineMode) enterEngineMode(t);
    else engineScrubTo(t);
    lastAppliedSeek = t;
    pendingSeek = null;
    updateScrub(t);
    syncVisualTime(t);
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const t = timeFromClientX(e.clientX);
    pendingSeek = t; // defer the expensive rebuild to frame() (coalesced)
    updateScrub(t); // but move the bar/thumb instantly for responsiveness
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    pendingSeek = null;
    const t = timeFromClientX(e.clientX);
    engineScrubTo(t); // land the final position (morphed, no rebuild flash)
    // Pause on release: keep the morphed frame displayed, stay in engine mode.
    setPaused(true);
    syncVisualTime(t);
    showControls();
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // Click anywhere on the replay (the shield) to pause/resume — like a video.
  function togglePlay(): void {
    if (paused) {
      const t = curTime();
      // if it had finished, a click replays from the beginning
      const restart = t >= totalTime - 50;
      // Hand rendering back to the visible replayer for forward playback. If we were
      // in engine mode (after a scrub), this is the single point where the visible doc
      // rebuilds — folded into the resume. A restart is a full rebuild too; re-arm the
      // reveal gate to hide it, and hide the stage SYNCHRONOUSLY now — the rebuild
      // event lags a frame and play(0) resets the clock immediately, so without this
      // the cursor would flash a teleport from the last click to the first.
      if (restart || engineMode) {
        revealGateArmed = true;
        hideReplay();
      }
      engineMode = false;
      replayer.play(restart ? 0 : t);
      setPaused(false);
      startLoop();
    } else {
      replayer.pause();
      setPaused(true);
    }
    showControls();
  }
  shield.addEventListener('click', togglePlay);
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });
  // At the end, surface the play badge so a click replays from the start.
  replayer.on('finish', () => setPaused(true));

  let lastCurX: number | null = null;
  let lastCurY: number | null = null;
  let lastCurScale = -1;
  let rafId: number | null = null;
  function startLoop(): void {
    if (rafId == null && !destroyed) rafId = requestAnimationFrame(frame);
  }
  function frame(): void {
    if (destroyed) {
      rafId = null;
      return;
    }
    // Reschedule only while actually playing (or scrubbing) — don't spin the rAF loop
    // while paused/finished, to save CPU.
    rafId = !paused || dragging ? requestAnimationFrame(frame) : null;
    // Coalesced scrub: apply at most the LATEST pending seek this frame. Routed
    // through the engine+morphdom (no visible rebuild).
    if (dragging && pendingSeek != null && pendingSeek !== lastAppliedSeek) {
      engineScrubTo(pendingSeek);
      lastAppliedSeek = pendingSeek;
      syncVisualTime(pendingSeek);
      pendingSeek = null;
    }
    const T = curTime();
    if (!dragging) updateScrub(T); // keep the bar in sync during playback
    if (T < prevT || T - prevT > 250) {
      appliedScroll.clear();
    }
    applyDirectedScroll(T);
    if (prepareClickVisibility(T)) applyDirectedScroll(T, true);

    let directive: void | { advanceTo: number } = undefined;
    try {
      directive = options.onFrame?.({
        time: T,
        document: replayer.iframe?.contentDocument ?? null,
        locale: ACTIVE_LOCALE ?? undefined,
        events,
        overlayRoot: director,
      });
    } catch {
      // A host-provided frame director cannot break the base replay.
    }
    const advanceTo =
      directive && 'advanceTo' in directive ? directive.advanceTo : undefined;
    if (!dragging && typeof advanceTo === 'number' && advanceTo > T + 1) {
      const targetTime = Math.min(totalTime, advanceTo);
      replayer.pause(targetTime);
      if (!paused) replayer.play(targetTime);
      appliedScroll.clear();
      syncVisualTime(targetTime);
      updateScrub(targetTime);
      return;
    }

    if (!stageRevealed) {
      cursor.classList.remove('on', 'clicking');
      ring.style.display = 'none';
      return;
    }
    prevT = T;
    if (usesTouchControls) {
      cursor.classList.remove('on', 'clicking');
      renderClickEffects(T);
      return;
    }
    const pos = positionAt(T);
    if (!pos) {
      cursor.classList.remove('on', 'clicking');
      ring.style.display = 'none';
      return;
    }
    cursor.classList.add('on');
    const cx = offsetX + pos.x * scale;
    const cy = offsetY + pos.y * scale;
    if (cx !== lastCurX || cy !== lastCurY || scale !== lastCurScale) {
      lastCurX = cx;
      lastCurY = cy;
      lastCurScale = scale;
      cursor.style.transform =
        'translate(' + cx + 'px,' + cy + 'px) scale(' + scale + ')';
    }
    renderClickEffects(T);
  }
  applyThemeMode(); // initial theme assert (the frame loop no longer does it)
  // NB: startLoop() is deliberately NOT called here — it starts in beginPlaybackOnce()
  // at reveal, so the cursor never shows over a blank stage.

  // Locale flag switcher: one clickable flag per traced locale. Switch locale WITHOUT
  // reloading: read the target overlay, revert the nodes we swapped back to source,
  // apply the new overlay over the LIVE DOM. Structure/images are untouched, so
  // there's zero rebuild flash — only translated text changes.
  let switching = false;
  function switchLocale(loc: string): void {
    if (switching || loc === ACTIVE_LOCALE) return;
    switching = true;
    // Locale switching operates on the visible replayer's live DOM via its mirror. If
    // we're mid/post-scrub (engine mode, visible doc morphed), hand rendering back
    // first so the mirror + DOM are authoritative again.
    if (engineMode) {
      // Read the engine clock before changing which clock curTime() selects.
      // Otherwise a locale switch after scrubbing seeks back to the stale,
      // frozen visible-player time and host frame directors receive a rewind.
      const timelineTime = curTime();
      engineMode = false;
      revealGateArmed = true;
      replayer.pause(timelineTime);
    }
    try {
      const isSource = !loc || loc === SOURCE_LOCALE;
      let newOverlay: Record<number, string> | null = null;
      if (!isSource && demoLocales && demoLocales.locales.indexOf(loc) !== -1) {
        newOverlay = overlayFor(loc);
      }
      // revert previously-swapped nodes to their recorded source text
      const oldOverlay = overlay;
      const revertOverlay = (targetMirror: ReplayMirror | null) => {
        if (!oldOverlay || !targetMirror) return;
        for (const nid of swapped) {
          const n = targetMirror.getNode(nid);
          if (n && n.nodeType === 3) {
            const src = RECORDED_SRC.get(nid);
            if (src !== undefined && n.textContent === oldOverlay[nid])
              n.textContent = src;
          }
        }
      };
      revertOverlay(mirror);
      // The hidden scrub engine is persistent. Reset it too, otherwise seeking
      // after a second locale switch morphs stale translated text back into the
      // visible replay document.
      revertOverlay(engineMirror);
      swapped.clear();
      overlay = newOverlay;
      ACTIVE_LOCALE = loc;
      attachTranslator();
      const fEl = container.querySelector('#flags');
      if (fEl)
        [...fEl.children].forEach((b) =>
          (b as HTMLElement).classList.toggle(
            'active',
            (b as HTMLElement).dataset.loc === loc,
          ),
        );
      appliedScroll.clear();
      resetSyntheticScrolls();
      applyDirectedScroll(curTime(), true);
      startLoop();
    } finally {
      switching = false;
    }
  }

  // Source → "/" (renders as recorded), targets → the locale. Active one highlighted.
  (function setupFlags(): void {
    const flagsEl = container.querySelector('#flags');
    const sep = container.querySelector('#localeSep');
    if (
      !flagsEl ||
      !demoLocales ||
      !demoLocales.locales.length ||
      options.switchLocalesAllowed === false
    ) {
      if (sep) (sep as HTMLElement).style.display = 'none';
      return;
    }
    const source = demoLocales.sourceLocale;
    // Language → canonical country, so variants stay visually distinct; fall back to
    // region.
    const LANG_COUNTRY: Record<string, string> = {
      en: 'US',
      fr: 'FR',
      es: 'ES',
      de: 'DE',
      it: 'IT',
      pt: 'BR',
      nl: 'NL',
      ja: 'JP',
      zh: 'CN',
      ko: 'KR',
      ru: 'RU',
      ar: 'SA',
      hi: 'IN',
      pl: 'PL',
      tr: 'TR',
      sv: 'SE',
      da: 'DK',
      fi: 'FI',
      nb: 'NO',
      no: 'NO',
      cs: 'CZ',
      el: 'GR',
      he: 'IL',
      th: 'TH',
      vi: 'VN',
      id: 'ID',
      uk: 'UA',
      ro: 'RO',
      hu: 'HU',
    };
    const toFlag = (loc: string): string => {
      const lang = (loc.split('-')[0] || '').toLowerCase();
      const region = (loc.split('-')[1] || '').toUpperCase();
      const cc =
        LANG_COUNTRY[lang] || (/^[A-Z]{2}$/.test(region) ? region : '');
      if (/^[A-Z]{2}$/.test(cc))
        return String.fromCodePoint(
          ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
        );
      return '🌐';
    };
    for (const loc of demoLocales.locales) {
      const btn = ownerDoc.createElement('button');
      btn.type = 'button';
      btn.textContent = toFlag(loc);
      btn.title = loc + (loc === source ? ' (source)' : '');
      btn.dataset.loc = loc;
      if (loc === ACTIVE_LOCALE) btn.classList.add('active');
      btn.onclick = () => switchLocale(loc); // in-place, no reload → no flash
      flagsEl.appendChild(btn);
    }
  })();

  const DOWNLOAD_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  const downloadJson = must<HTMLButtonElement>('#downloadJson');
  downloadJson.innerHTML = DOWNLOAD_SVG;
  downloadJson.title = 'Download replay JSON';
  downloadJson.onclick = (event) => {
    event.stopPropagation();
    const locale = String(SOURCE_LOCALE || 'source').replace(
      /[^a-z0-9._-]+/gi,
      '-',
    );
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle)], { type: 'application/json' }),
    );
    const anchor = ownerDoc.createElement('a');
    anchor.href = url;
    anchor.download = `gt-replay-${locale}-${date}.json`;
    anchor.style.display = 'none';
    ownerDoc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Build the frame-0 snapshot now (so the reveal gate can detect that styles have
  // applied) WITHOUT advancing the timeline. Actual playback starts in
  // beginPlaybackOnce() the moment the stage is revealed.
  replayer.pause(0);

  // ---- teardown ---------------------------------------------------------- //
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener('resize', fit);
    ownerDoc.removeEventListener('fullscreenchange', onFsChange);
    if (ownerDoc.fullscreenElement === container)
      ownerDoc.exitFullscreen?.().catch(() => {});
    if (resizeObs) resizeObs.disconnect();
    if (translateObserver) translateObserver.disconnect();
    if (hideTimer) clearTimeout(hideTimer);
    if (warmTimer) clearTimeout(warmTimer);
    try {
      options.onFrame?.({
        time: Number.NaN,
        document: null,
        locale: ACTIVE_LOCALE ?? undefined,
        events,
        overlayRoot: null,
      });
    } catch {}
    try {
      replayer.pause();
    } catch {}
    try {
      if (engine) engine.pause();
    } catch {}
    engineHost.remove();
    container.innerHTML = '';
    container.classList.remove(GT_REPLAYER_CLASS, 'chrome-light');
  }

  return { destroy };
}

// ---- debug hot-swap helpers ------------------------------------------------ //

/** Coerce dropped JSON into a bundle: a raw events array or {events,...}. */
function toBundle(parsed: unknown): GTReplayerBundle | null {
  if (Array.isArray(parsed))
    return parsed.length >= 2 ? { events: parsed as eventWithTime[] } : null;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as { events?: unknown };
    if (Array.isArray(o.events) && o.events.length >= 2)
      return parsed as GTReplayerBundle;
  }
  return null;
}

/**
 * Recover the recorder's self-describing metadata from the event stream: the
 * `gt-locales` ({locales, sourceLocale}) and `gt-i18n` (overlay) custom events it
 * splices in. Used as a fallback when a bundle omits the structured
 * `locales`/`overlay` fields (e.g. a raw events-only export or debug drop).
 */
function readEmbedded(events: eventWithTime[] | undefined): {
  locales?: readonly string[];
  overlay?: LocaleTextOverlay;
} {
  // Wire-format tags the recorder writes (GT_EVENT.locales / GT_EVENT.i18n in
  // ../types). Inlined here so `./replay` stays a single self-contained bundle
  // rather than sharing a runtime chunk with the recorder entry.
  const LOCALES_TAG = 'gt-locales';
  const I18N_TAG = 'gt-i18n';
  const out: { locales?: readonly string[]; overlay?: LocaleTextOverlay } = {};
  if (!Array.isArray(events)) return out;
  for (const e of events) {
    // rrweb custom events are EventType.Custom (5) with { tag, payload } data.
    const ev = e as {
      type?: number;
      data?: { tag?: string; payload?: unknown };
    };
    if (ev.type !== 5 || !ev.data) continue;
    const { tag, payload } = ev.data;
    if (tag === LOCALES_TAG && payload && typeof payload === 'object') {
      const p = payload as { locales?: unknown };
      if (
        Array.isArray(p.locales) &&
        p.locales.every((l) => typeof l === 'string')
      )
        out.locales = p.locales as string[];
    } else if (tag === I18N_TAG && payload && typeof payload === 'object') {
      out.overlay = payload as LocaleTextOverlay;
    }
  }
  return out;
}

/** Transient in-player notice (debug drop feedback); auto-removes. */
function showNotice(container: HTMLElement, msg: string): void {
  const doc = container.ownerDocument ?? document;
  const note = doc.createElement('div');
  note.className = 'gt-debug-notice';
  note.textContent = msg;
  container.appendChild(note);
  setTimeout(() => note.remove(), 2200);
}

/**
 * Mount the GT replayer into `container` and start playing `bundle`.
 *
 * Renders a self-contained player: a letterboxed rrweb stage cropped to the
 * recorder's capture frame, a synthesized "director" cursor that eases between the
 * recorded clicks, a YouTube-style scrubber (with a hidden engine-replayer +
 * morphdom for flicker-free backward scrubbing), light/dark + full-screen toggles,
 * and — when the bundle carries locales and `switchLocalesAllowed` isn't false — a
 * flag switcher that swaps the per-locale text overlay in place with no rebuild.
 *
 * With `debug: true`, dropping a recording JSON file onto the player hot-swaps the
 * replay; non-JSON / non-recording files fail gracefully with a notice.
 *
 * `container` should be sized by its parent (the player fills the width and sets
 * its own aspect). Returns a handle; call `destroy()` to tear everything down.
 */
export function createGTReplayer(
  container: HTMLElement,
  bundle: GTReplayerBundle,
  options: GTReplayerOptions = {},
): GTReplayerHandle {
  let inner = createPlayerInstance(container, bundle, options);
  if (!options.debug) return { destroy: () => inner.destroy() };

  // Debug: drag a recording JSON onto the player to replace the replay in place.
  // Listeners live on the container (outside the instance), so they survive swaps.
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    container.classList.add('gt-debug-drop');
  };
  const onDragLeave = (): void => container.classList.remove('gt-debug-drop');
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    container.classList.remove('gt-debug-drop');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    file.text().then(
      (text) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          showNotice(container, `Not a JSON file: ${file.name}`);
          return;
        }
        const next = toBundle(parsed);
        if (!next) {
          showNotice(container, `Not a recording: ${file.name}`);
          return;
        }
        inner.destroy();
        inner = createPlayerInstance(container, next, options);
      },
      () => showNotice(container, `Could not read ${file.name}`),
    );
  };
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('dragleave', onDragLeave);
  container.addEventListener('drop', onDrop);

  return {
    destroy() {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
      container.classList.remove('gt-debug-drop');
      inner.destroy();
    },
  };
}
