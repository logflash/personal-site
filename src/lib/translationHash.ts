import { hashMessage } from 'gt-i18n/internal'

export function translationHash(message: string) {
  return hashMessage(message, { $format: 'ICU' })
}
