import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import mdx from '@mdx-js/rollup'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))

// Public files are served at their own names, so the resume's route is just
// its filename (e.g. /IanResume_14.3.pdf). The name is versioned, so discover
// it at startup and inject it as the site's Resume link. After swapping in a
// new PDF, restart the dev server to refresh the link.
const resumePdf = readdirSync(PUBLIC_DIR).find((name) => name.toLowerCase().endsWith('.pdf'))

// Inlined into a <style> tag in production (removes the only render-blocking
// request); dev uses a normal stylesheet link so CSS edits stay live.
const inlineCss = ['src/styles/fonts.css', 'src/styles/global.css']
  .map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

export default defineConfig({
  // MDX stays a build-time concern: its output passes through the same React
  // and TanStack Start SSR pipeline as the handwritten TSX components.
  plugins: [tanstackStart(), mdx(), viteReact()],
  define: {
    __RESUME_HREF__: JSON.stringify(resumePdf ? `/${resumePdf}` : ''),
    __INLINE_CSS__: JSON.stringify(inlineCss),
  },
})
