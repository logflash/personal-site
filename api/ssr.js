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
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value)
  })
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)
  res.end(Buffer.from(await response.arrayBuffer()))
}
