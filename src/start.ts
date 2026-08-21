import { createStart } from '@tanstack/react-start'
import { gtMiddleware } from 'gt-tanstack-start'

// gtMiddleware resolves the request locale (cookie, then Accept-Language)
// so getLocale() works in loaders during SSR.
export const startInstance = createStart(() => ({
  requestMiddleware: [gtMiddleware],
}))
