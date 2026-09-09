// Minimal local production server: serves dist/client statics and hands
// everything else to the built TanStack Start fetch handler. Deployment
// platforms (e.g. Vercel) provide their own equivalent of this wrapper.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const PORT = process.env.PORT ?? 3000
const CLIENT_DIR = resolve('dist/client')
const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.html': 'text/html',
}

const { default: handler } = await import('../dist/server/server.js')

const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.xml', '.txt', ''])

function send(req, res, status, headers, body) {
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  const ext = headers['content-type']?.startsWith('text/html')
    ? ''
    : extname(new URL(`http://x${req.url}`).pathname)
  if (acceptsGzip && body.length > 1024 && COMPRESSIBLE.has(ext)) {
    body = gzipSync(body)
    headers['content-encoding'] = 'gzip'
  }
  res.writeHead(status, headers)
  res.end(body)
}

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(req.url.split('?')[0])
    const filePath = resolve(CLIENT_DIR, `.${pathname}`)
    const isClientAsset = filePath.startsWith(`${CLIENT_DIR}${sep}`)
    if (pathname !== '/' && isClientAsset && existsSync(filePath)) {
      const data = await readFile(filePath).catch(() => null)
      if (data) {
        send(
          req,
          res,
          200,
          { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' },
          data,
        )
        return
      }
    }
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
    })
    const response = await handler.fetch(request)
    send(
      req,
      res,
      response.status,
      Object.fromEntries(response.headers),
      Buffer.from(await response.arrayBuffer()),
    )
  } catch (error) {
    res.writeHead(500)
    res.end(String(error))
  }
}).listen(PORT, () => console.log(`serving production build on http://localhost:${PORT}`))
