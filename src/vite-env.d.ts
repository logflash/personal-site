/// <reference types="vite/client" />

declare module '*.mdx' {
  import type { ComponentType } from 'react'

  const MDXContent: ComponentType<{
    components?: Record<string, ComponentType<any>>
  }>
  export default MDXContent
}

/** Route of the resume PDF in public/, injected by `define` in vite.config.ts. */
declare const __RESUME_HREF__: string

/** Site CSS inlined at build time by `define` in vite.config.ts. */
declare const __INLINE_CSS__: string
