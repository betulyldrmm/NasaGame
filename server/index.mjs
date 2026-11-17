/**
 * Bağımlılıksız Node.js backend:
 *  - Derlenmiş oyunu sunar (dist/)
 *  - Kullanıcı hesabı & oturum yönetimi (/api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me)
 *  - Hesaba özel oyun kayıtları (GET/POST /api/save → server/data/saves/<kullanıcı>.json)
 */
import { createServer } from 'node:http'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachMultiplayerWs, listPublicRooms } from './mp.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'dist')
const dataDir = join(root, 'server', 'data')
const savesDir = join(dataDir, 'saves')
const usersFile = join(dataDir, 'users.json')
const sessionsFile = join(dataDir, 'sessions.json')
const port = Number(process.env.PORT ?? 8787)
const SESSION_COOKIE = 'nasagame_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
}

let writeQueue = Promise.resolve()
function serialized(fn) {
  const next = writeQueue.then(fn, fn)
  writeQueue = next.catch(() => {})
  return next
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.assign(Object.create(null), parsed) : fallback
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await mkdir(dataDir, { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function parseCookies(req) {
  const out = {}
  const header = req.headers.cookie
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  res.end(JSON.stringify(data))
}

async function readBody(req, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) throw new HttpError(413, 'İstek boyutu çok büyük.')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function savePathForUser(key) {
  if (!USERNAME_RE.test(key)) throw new HttpError(400, 'Geçersiz kullanıcı adı.')
  const base = resolve(savesDir)
  const target = resolve(savesDir, `${key}.json`)
  if (!target.startsWith(base + sep)) throw new HttpError(403, 'Yasak yol.')
  return target
}

function makeCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (!token) return null
  const sessions = await readJson(sessionsFile, Object.create(null))
  const sess = Object.hasOwn(sessions, token) ? sessions[token] : null
  if (!sess || sess.expiresAt < Date.now()) return null
  const users = await readJson(usersFile, Object.create(null))
  const u = Object.hasOwn(users, sess.key) ? users[sess.key] : null
  if (!u) return null
  return { key: sess.key, username: u.username, token }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/mp/rooms' && req.method === 'GET') {
      sendJson(res, 200, { rooms: listPublicRooms() })
      return
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const user = await getSessionUser(req)
      sendJson(res, 200, { user: user ? { username: user.username } : null })
      return
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const raw = await readBody(req, 16_384)
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new HttpError(400, 'Geçersiz JSON.')
      }
      const username = typeof parsed?.username === 'string' ? parsed.username.trim() : ''
      const password = typeof parsed?.password === 'string' ? parsed.password : ''
      if (!USERNAME_RE.test(username)) {
        throw new HttpError(400, 'Kullanıcı adı 3–24 karakter olmalı ve yalnızca harf, rakam, _ veya - içermelidir.')
      }
      if (password.length < 4 || password.length > 128) {
        throw new HttpError(400, 'Şifre en az 4 karakter olmalıdır.')
      }
      const key = username.toLowerCase()
      const token = await serialized(async () => {
        const users = await readJson(usersFile, Object.create(null))
        if (Object.hasOwn(users, key)) throw new HttpError(409, 'Bu kullanıcı adı zaten alınmış.')
        const salt = randomBytes(16).toString('hex')
        users[key] = {
          username,
          salt,
          passwordHash: hashPassword(password, salt),
          createdAt: Date.now(),
        }
        await writeJson(usersFile, users)
        const sessions = await readJson(sessionsFile, Object.create(null))
        const tok = randomBytes(32).toString('hex')
        sessions[tok] = { key, expiresAt: Date.now() + SESSION_TTL_MS }
        await writeJson(sessionsFile, sessions)
        return tok
      })
      sendJson(res, 201, { user: { username } }, { 'Set-Cookie': makeCookie(token, Math.floor(SESSION_TTL_MS / 1000)) })
      return
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const raw = await readBody(req, 16_384)
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new HttpError(400, 'Geçersiz JSON.')
      }
      const username = typeof parsed?.username === 'string' ? parsed.username.trim() : ''
      const password = typeof parsed?.password === 'string' ? parsed.password : ''
      if (password.length > 128) throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı.')
      const key = username.toLowerCase()
      const users = await readJson(usersFile, Object.create(null))
      const user = Object.hasOwn(users, key) ? users[key] : null
      if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
        throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı.')
      }
      const token = await serialized(async () => {
        const sessions = await readJson(sessionsFile, Object.create(null))
        const now = Date.now()
        for (const [k, s] of Object.entries(sessions)) {
          if (!s || s.expiresAt < now) delete sessions[k]
        }
        const tok = randomBytes(32).toString('hex')
        sessions[tok] = { key, expiresAt: now + SESSION_TTL_MS }
        await writeJson(sessionsFile, sessions)
        return tok
      })
      const rawSave = await readFile(savePathForUser(key), 'utf8').catch(() => 'null')
      let parsedSave = null
      try {
        parsedSave = JSON.parse(rawSave)
      } catch {
        parsedSave = null
      }
      sendJson(
        res,
        200,
        { user: { username: user.username }, save: parsedSave },
        { 'Set-Cookie': makeCookie(token, Math.floor(SESSION_TTL_MS / 1000)) },
      )
      return
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE]
      if (token) {
        await serialized(async () => {
          const sessions = await readJson(sessionsFile, Object.create(null))
          delete sessions[token]
          await writeJson(sessionsFile, sessions)
        })
      }
      res.writeHead(204, { 'Set-Cookie': makeCookie('', 0) }).end()
      return
    }

    if (url.pathname === '/api/save') {
      const user = await getSessionUser(req)
      if (!user) throw new HttpError(401, 'Kayıt için giriş yapmalısınız.')
      const saveFile = savePathForUser(user.key)
      if (req.method === 'POST') {
        const body = await readBody(req, 5_000_000)
        let parsed
        try {
          parsed = JSON.parse(body)
        } catch {
          throw new HttpError(400, 'Geçersiz kayıt verisi.')
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new HttpError(400, 'Geçersiz kayıt verisi.')
        }
        await serialized(async () => {
          await mkdir(savesDir, { recursive: true })
          const tmp = `${saveFile}.${process.pid}.${Date.now()}.tmp`
          await writeFile(tmp, body, 'utf8')
          await rename(tmp, saveFile)
        })
        res.writeHead(204).end()
        return
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Desteklenmeyen yöntem.')
      const data = await readFile(saveFile, 'utf8').catch(() => 'null')
      let safeJson = 'null'
      try {
        JSON.parse(data)
        safeJson = data
      } catch {
        safeJson = 'null'
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(safeJson)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      throw new HttpError(404, 'API uç noktası bulunamadı.')
    }

    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = resolve(dist, rel === '/' || rel === '\\' ? 'index.html' : rel.replace(/^[/\\]+/, ''))
    if (file !== dist && !file.startsWith(dist + sep)) throw new HttpError(403, 'Forbidden')
    const ext = extname(file)
    try {
      const data = await readFile(file)
      res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' }).end(data)
    } catch {
      if (ext && ext !== '.html') {
        res.writeHead(404).end('Not found')
        return
      }
      const html = await readFile(join(dist, 'index.html')).catch(() => null)
      if (!html) {
        res.writeHead(404).end('Build missing (npm run build)')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
    }
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message })
      return
    }
    console.error('[server error]', err)
    sendJson(res, 500, { error: 'Sunucu içi hata oluştu.' })
  }
})

attachMultiplayerWs(server)
server.listen(port, () => console.log(`NasaGame sunucusu: http://localhost:${port}`))
