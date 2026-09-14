import { defineConfig } from 'tsdown'

const runtimeEntries = ['src/index.ts', 'src/compiler/index.ts', 'src/sdf-runtime/index.ts']
const esmEntries = [...runtimeEntries, 'src/build/index.ts', 'src/cli.ts']

export default defineConfig([
  {
    entry: runtimeEntries,
    format: ['cjs'],
    target: 'es2022',
    dts: true,
    clean: true,
  },
  {
    entry: esmEntries,
    format: ['esm'],
    target: 'es2022',
    dts: true,
  },
])
