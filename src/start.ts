import { createMiddleware, createStart } from '@tanstack/react-start'
import { getResponseHeaders, setResponseHeaders } from '@tanstack/react-start/server'
import {
  createCspNonce,
  createSecurityHeaders,
  getRequestRejection,
  isTrustedMutationRequest,
} from './lib/security'

const securityMiddleware = createMiddleware().server(async ({ request, next }) => {
  const nonce = createCspNonce()
  const securityHeaders = createSecurityHeaders(nonce, import.meta.env.DEV)
  const rejection = getRequestRejection(request)

  if (rejection) {
    return new Response(rejection.message, {
      status: rejection.status,
      headers: { ...securityHeaders, ...rejection.headers },
    })
  }

  if (!isTrustedMutationRequest(request)) {
    return new Response('Cross-origin state-changing requests are not allowed.', {
      status: 403,
      headers: securityHeaders,
    })
  }

  // Keep the unlisted shortcut out of page markup and the client route manifest.
  const pathname = new URL(request.url).pathname
  if (pathname === '/zoom' || pathname === '/zoom/') {
    return new Response(null, {
      status: 307,
      headers: {
        ...securityHeaders,
        Location: 'https://mit.zoom.us/j/9746406124',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    })
  }

  const headers = getResponseHeaders()
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value)
  setResponseHeaders(headers)

  return next({ context: { cspNonce: nonce } })
})

export const startInstance = createStart(() => ({
  requestMiddleware: [securityMiddleware],
}))
