// Native select popups are a platform behavior, not a viewport-size feature.
// Android can report hover/fine input with a pen or mouse; iPadOS can identify
// as a Mac. Resolve these before the first paint, without changing SSR markup.
// Keep the CSS touch-input fallback for browsers with reduced platform data.
export const LOCALE_PICKER_BOOT_SCRIPT = `(()=>{const n=navigator;const ua=n.userAgent;const mobile=n.userAgentData?.mobile||n.userAgentData?.platform==='Android'||/Android|iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&n.maxTouchPoints>1);if(mobile)document.documentElement.dataset.nativeLocalePicker=''})()`
