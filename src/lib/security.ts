const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SUPPORTED_METHODS = new Set([...SAFE_METHODS, 'POST', 'PUT', 'PATCH', 'DELETE'])
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024

export type RequestRejection = {
  status: number
  message: string
  headers?: Record<string, string>
}

export const CSP_NONCE_META_SELECTOR = 'meta[property="csp-nonce"]'

/**
 * React writes TanStack Start's hydration import into an HTMLScriptElement.
 * Trusted Types therefore needs a default policy. Executable text is limited
 * to same-origin imports, while valid JSON supports non-executable JSON-LD.
 * HTML is limited to React's two inert operations; script URLs stay unavailable.
 */
export const TRUSTED_TYPES_BOOT_SCRIPT = `(()=>{const tt=globalThis.trustedTypes;if(!tt)return;tt.createPolicy('default',{createHTML(value){if(value===''||value==='<'+'script></'+'script>')return value;throw new TypeError('HTML string sinks are disabled')},createScript(value){try{JSON.parse(value);return value}catch{}try{if(!value.startsWith('import(')||!value.endsWith(')'))throw 0;const specifier=JSON.parse(value.slice(7,-1));if(typeof specifier!=='string'||!specifier.startsWith('/'))throw 0;const url=new URL(specifier,location.href);if(url.origin!==location.origin)throw 0;return value}catch{throw new TypeError('Only JSON and same-origin hydration imports are allowed')}},createScriptURL(){throw new TypeError('Script URL string sinks are disabled')}})})()`

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
    "child-src 'self'",
    "frame-src 'self'",
    "media-src 'none'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types default',
  ]

  if (!development) directives.push('upgrade-insecure-requests')
  return `${directives.join('; ')};`
}

export function createSecurityHeaders(nonce: string, development: boolean) {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': createContentSecurityPolicy(nonce, development),
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy':
      'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(self), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), otp-credentials=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), storage-access=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    Vary: 'Sec-Fetch-Site, Origin, Referer',
    'X-Content-Type-Options': 'nosniff',
    'X-DNS-Prefetch-Control': 'off',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none',
  } as const
}

export function getRequestRejection(request: Request): RequestRejection | null {
  const method = request.method.toUpperCase()
  if (!SUPPORTED_METHODS.has(method)) {
    return {
      status: 405,
      message: 'Method not allowed.',
      headers: { Allow: [...SUPPORTED_METHODS].join(', ') },
    }
  }

  if (SAFE_METHODS.has(method)) return null

  const contentEncoding = request.headers.get('content-encoding')?.trim().toLowerCase()
  if (contentEncoding && contentEncoding !== 'identity') {
    return { status: 415, message: 'Encoded request bodies are not accepted.' }
  }

  const rawLength = request.headers.get('content-length')
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) {
      return { status: 400, message: 'Invalid Content-Length header.' }
    }
    const length = Number(rawLength)
    if (!Number.isSafeInteger(length) || length < 0) {
      return { status: 400, message: 'Invalid Content-Length header.' }
    }
    if (length > MAX_REQUEST_BODY_BYTES) {
      return { status: 413, message: 'Request body is too large.' }
    }
  } else if (request.headers.has('transfer-encoding') || request.headers.has('content-type')) {
    return { status: 411, message: 'Content-Length is required.' }
  }

  return null
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
