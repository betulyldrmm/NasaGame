/**
 * Küçük Node.js backend (bağımlılıksız): derlenmiş oyunu sunar ve kayıt dosyasını saklar.
 *   npm run build && npm run server   →  http://localhost:8787
 * GET  /api/save  → son kayıt (JSON)   ·   POST /api/save → kaydı yazar
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const dataDir = join(root, 'server', 'data')
const saveFile = join(dataDir, 'save.json')
const port = Number(process.env.PORT ?? 8787)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/save') {
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 5_000_000) throw new Error('too large')
        }
        JSON.parse(body)
        await mkdir(dataDir, { recursive: true })
        await writeFile(saveFile, body)
        res.writeHead(204).end()
        return
      }
      const data = await readFile(saveFile, 'utf8').catch(() => 'null')
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(data)
      return
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dist, rel === '/' || rel === '\\' ? 'index.html' : rel)
    if (!file.startsWith(dist)) throw new Error('forbidden')
    const data = await readFile(file).catch(() => readFile(join(dist, 'index.html')))
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'text/html; charset=utf-8' }).end(data)
  } catch {
    res.writeHead(400).end('Bad request')
  }
}).listen(port, () => console.log(`NasaGame sunucusu: http://localhost:${port}`))
