import { translationHashes } from '../generated/translationHashes'

export function translationHash(message: string) {
  const hash = translationHashes[message]
  if (!hash) {
    throw new Error(
      `Message is missing from the English GTJSON catalog: ${JSON.stringify(message)}`,
    )
  }
  return hash
}
