import type { FontMorphPreparedLoadRequest, FontMorphPreparedManifest } from 'glyphflux'

export function createPreparedGlyphfluxLoader(
  byKey: Readonly<Record<string, string>>,
  byText: Readonly<Record<string, readonly string[]>>,
  fetchManifest: typeof fetch = fetch,
) {
  const requests = new Map<string, Promise<FontMorphPreparedManifest>>()
  const load = (url: string) => {
    let pending = requests.get(url)
    if (!pending) {
      pending = fetchManifest(url).then(async (response) => {
        if (!response.ok)
          throw new Error(`Unable to load prepared Glyphflux data: ${response.status}`)
        return (await response.json()) as FontMorphPreparedManifest
      })
      requests.set(url, pending)
      // A document switch can cancel preparation. Allow a later attempt to retry.
      void pending.catch(() => requests.delete(url))
    }
    return pending
  }

  return (text: string, request?: FontMorphPreparedLoadRequest) => {
    if (!byText[text]) return undefined
    const urls = request
      ? [...new Set([byKey[request.key], byKey[request.reverseKey]].filter(Boolean))]
      : byText[text]
    if (!urls.length) return undefined
    return Promise.all(urls.map(load)).then((manifests): FontMorphPreparedManifest => {
      if (manifests.length === 1) return manifests[0]
      return {
        version: 2,
        outlines: Object.assign({}, ...manifests.map((manifest) => manifest.outlines)),
        sdfMorphs: Object.assign(
          {},
          ...manifests.map((manifest) => (manifest.version === 2 ? manifest.sdfMorphs : {})),
        ),
      }
    })
  }
}
