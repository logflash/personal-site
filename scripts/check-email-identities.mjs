// Guards the email-obfuscation policy: the contact email is published only as
// obfuscated plain text ('user [at] domain [dot] com'), so no raw address or
// mailto: link may appear in tracked text sources. Fails the lint if one does.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.md',
  '.mdx',
  '.txt',
  '.xml',
])
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const MAILTO = /mailto:/i

// This script necessarily contains the patterns it forbids, so it skips itself.
const SELF = 'scripts/check-email-identities.mjs'

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && file !== SELF && existsSync(file) && TEXT_EXTENSIONS.has(extname(file)))

const offenders = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    const match = line.match(EMAIL) ?? line.match(MAILTO)
    if (match) offenders.push(`${file}:${index + 1} — ${match[0]}`)
  })
}

if (offenders.length > 0) {
  console.error('Raw email addresses / mailto: links are not allowed in source:')
  for (const offender of offenders) console.error(`  ${offender}`)
  process.exit(1)
}
