const INVISIBLE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu
const MAX_DISPLAY_PATH_CHARACTERS = 240

/**
 * Makes an attacker-controlled URL path safe and legible for display.
 * React supplies the XSS boundary by escaping this return value into a text
 * node; this additionally removes control/bidirectional spoofing characters
 * and bounds the amount of route text rendered on the page.
 */
export function sanitizeDisplayPath(pathname: string) {
  const sanitized = pathname.normalize('NFC').replace(INVISIBLE_CONTROL_CHARACTERS, '�')
  const characters = [...sanitized]
  if (characters.length <= MAX_DISPLAY_PATH_CHARACTERS) return sanitized
  return `${characters.slice(0, MAX_DISPLAY_PATH_CHARACTERS).join('')}…`
}
