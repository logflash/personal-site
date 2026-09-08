import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    sourcemap: true,
  },
])
