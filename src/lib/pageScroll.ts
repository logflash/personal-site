/** Recording moves page scrolling into the framed document column. */
export function pageScroller(): Element {
  return (
    document.querySelector('html.gt-recording .content') ??
    document.scrollingElement ??
    document.documentElement
  )
}
