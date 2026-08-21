// Minimal local production server: serves dist/client statics and hands
// everything else to the built TanStack Start fetch handler. Deployment
// platforms (e.g. Vercel) provide their own equivalent of this wrapper.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const PORT = process.env.PORT ?? 3000
const CLIENT_DIR = 'dist/client'
const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.html': 'text/html',
}

const { default: handler } = await import('../dist/server/server.js')

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(req.url.split('?')[0])
    const filePath = normalize(join(CLIENT_DIR, pathname))
    if (pathname !== '/' && filePath.startsWith(CLIENT_DIR) && existsSync(filePath)) {
      const data = await readFile(filePath).catch(() => null)
      if (data) {
        res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
        res.end(data)
        return
      }
    }
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
    })
    const response = await handler.fetch(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(500)
    res.end(String(error))
  }
}).listen(PORT, () => console.log(`serving production build on http://localhost:${PORT}`))
