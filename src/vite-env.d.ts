/// <reference types="vite/client" />

declare module '*.mdx' {
  import type { ComponentType } from 'react'

  const MDXContent: ComponentType<{
    components?: Record<string, ComponentType<any>>
  }>
  export default MDXContent
}

/** Site CSS inlined at build time by `define` in vite.config.ts. */
declare const __INLINE_CSS__: string
