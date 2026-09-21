const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const CSP_NONCE_META_SELECTOR = 'meta[property="csp-nonce"]'

export function createCspNonce() {
  return crypto.randomUUID().replaceAll('-', '')
}

export function createContentSecurityPolicy(nonce: string, development: boolean) {
  const connectSources = development ? "'self' ws: wss:" : "'self'"
  const directives = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    // The app and rrweb reconstruct dynamic presentation state. Keeping this
    // exception scoped to CSS leaves script execution nonce-gated.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]

  if (!development) directives.push('upgrade-insecure-requests')
  return `${directives.join('; ')};`
}

export function createSecurityHeaders(nonce: string, development: boolean) {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': createContentSecurityPolicy(nonce, development),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy':
      'accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), fullscreen=(self)',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    Vary: 'Sec-Fetch-Site, Origin, Referer',
    'X-Content-Type-Options': 'nosniff',
    'X-DNS-Prefetch-Control': 'off',
    'X-Frame-Options': 'DENY',
  } as const
}

/**
 * Rejects cross-origin state-changing requests before future server functions
 * or form actions can run. Authentication-backed forms should additionally
 * use a synchronizer token tied to their session.
 */
export function isTrustedMutationRequest(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true

  const expectedOrigin = new URL(request.url).origin
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false

  const origin = request.headers.get('origin')
  if (origin) return origin === expectedOrigin

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin
    } catch {
      return false
    }
  }

  return fetchSite === 'same-origin'
}
