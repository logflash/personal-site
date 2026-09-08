import { readFileSync } from 'node:fs'
import mdx from '@mdx-js/rollup'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Inlined into a <style> tag in production (removes the only render-blocking
// request); dev uses a normal stylesheet link so CSS edits stay live.
const inlineCss = ['src/styles/fonts.css', 'repos/font-morph/styles.css', 'src/styles/global.css']
  .map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

export default defineConfig({
  // MDX stays a build-time concern: its output passes through the same React
  // and TanStack Start SSR pipeline as the handwritten TSX components.
  plugins: [tanstackStart(), mdx(), viteReact()],
  define: {
    __INLINE_CSS__: JSON.stringify(inlineCss),
  },
  // Resolve the vendored packages' TypeScript directly so local changes
  // participate in Vite HMR and a clean checkout does not require committed dist.
  resolve: {
    alias: [
      {
        find: /^font-morph$/,
        replacement: fileURLToPath(new URL('./repos/font-morph/src/index.ts', import.meta.url)),
      },
      {
        find: /^gt-rrweb\/replay$/,
        replacement: fileURLToPath(new URL('./repos/gt-rrweb/src/replay.ts', import.meta.url)),
      },
      {
        find: /^gt-rrweb\/harvest$/,
        replacement: fileURLToPath(new URL('./repos/gt-rrweb/src/harvest.ts', import.meta.url)),
      },
      {
        find: /^gt-rrweb$/,
        replacement: fileURLToPath(new URL('./repos/gt-rrweb/src/index.ts', import.meta.url)),
      },
    ],
  },
})
