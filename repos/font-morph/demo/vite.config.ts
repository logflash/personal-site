import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const demoRoot = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  root: demoRoot,
  plugins: [react()],
  server: {
    fs: { allow: [packageRoot] },
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: fileURLToPath(new URL('../demo-dist', import.meta.url)),
    emptyOutDir: true,
  },
})
