import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))

// Vite serves public/ files at their own names, so the resume's route is just
// its filename (e.g. /IanResume_14.3.pdf). The name is versioned, so discover
// it at startup and inject it as the site's Resume link. After swapping in a
// new PDF, restart the dev server to refresh the link.
const resumePdf = readdirSync(PUBLIC_DIR).find((name) => name.toLowerCase().endsWith('.pdf'))

// Production builds swap React for preact/compat (~31 kB bundle vs ~205 kB;
// identical behavior for this app). Dev stays on real React so fast-refresh
// HMR keeps working. When migrating to TanStack Start, delete this alias
// block — Start needs real React at runtime.
const PREACT_BUILD_ALIASES = {
  'react-dom/client': 'preact/compat/client',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
  react: 'preact/compat',
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: command === 'build' ? PREACT_BUILD_ALIASES : undefined,
  },
  define: {
    __RESUME_HREF__: JSON.stringify(resumePdf ? `/${resumePdf}` : ''),
  },
}))
