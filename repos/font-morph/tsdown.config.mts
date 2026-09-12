import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/compiler/index.ts',
    'src/sdf-runtime/index.ts',
  ],
  format: ['cjs', 'esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
})
