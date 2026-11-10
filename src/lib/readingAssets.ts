// Also embedded as a parser-time script. Keep this function self-contained
// and valid JavaScript so the authored source is identical in SSR/hydration.
/** Assets required for a restored page's first complete frame. */
export async function readingAssetsReady() {
  await Promise.all([
    document.fonts.ready,
    ...Array.from(document.querySelectorAll('.resume-entry-logo img'), (image) =>
      // A failed logo must not prevent the résumé from becoming readable.
      image instanceof HTMLImageElement ? image.decode().catch(() => {}) : undefined,
    ),
  ])
}
