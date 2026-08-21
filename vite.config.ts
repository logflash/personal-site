import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))

// Public files are served at their own names, so the resume's route is just
// its filename (e.g. /IanResume_14.3.pdf). The name is versioned, so discover
// it at startup and inject it as the site's Resume link. After swapping in a
// new PDF, restart the dev server to refresh the link.
const resumePdf = readdirSync(PUBLIC_DIR).find((name) => name.toLowerCase().endsWith('.pdf'))

export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
  define: {
    __RESUME_HREF__: JSON.stringify(resumePdf ? `/${resumePdf}` : ''),
  },
})
