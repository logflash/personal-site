// Vercel serverless entry: adapts Node req/res to the TanStack Start fetch
// handler in dist/server. Static assets are served from dist/client by the
// CDN first (vercel.json rewrites only apply when no file matches).
import server from '../dist/server/server.js'

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }

  const request = new Request(`${proto}://${host}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half',
  })

  const response = await server.fetch(request)

  // Cache rendered locale pages on the CDN. gtMiddleware attaches a locale
  // cookie to every page, which would veto CDN caching — but on /:locale
  // pages it's deterministic (always the path's locale) and the client-side
  // locale switcher writes the same cookie, so it's safe to drop here. The
  // `/` redirect varies by cookie and Accept-Language: uncached, cookie kept.
  const cacheable = (req.method === 'GET' || req.method === 'HEAD') && response.status === 200
  if (cacheable) {
    res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=86400')
  }
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value)
  })
  if (!cacheable) {
    const cookies = response.headers.getSetCookie?.() ?? []
    if (cookies.length > 0) res.setHeader('set-cookie', cookies)
  }
  res.end(Buffer.from(await response.arrayBuffer()))
}
