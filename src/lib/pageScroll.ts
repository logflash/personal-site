/** Recording moves page scrolling into the framed document column. */
export function pageScroller(): Element {
  return (
    document.querySelector('html.gt-recording .content') ??
    document.scrollingElement ??
    document.documentElement
  )
}

// Scroll controls must match the SSR viewport before hydration. Keep their
// markup stable. Put state on body: gt-rrweb morphs body attributes when seeking.
export const SCROLL_STATE_BOOT_SCRIPT = `(()=>{const update=()=>{const scroller=document.querySelector('html.gt-recording .content')??document.scrollingElement;document.body?.toggleAttribute('data-page-scrolled',(scroller?.scrollTop??0)>0)};addEventListener('scroll',update,{passive:true,capture:true});addEventListener('site:scroll-positioned',update);new MutationObserver(update).observe(document.documentElement,{attributes:true,attributeFilter:['class']});update()})()`

export function syncScrollControls() {
  window.dispatchEvent(new Event('site:scroll-positioned'))
}
