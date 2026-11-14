/**
 * Bağımlılıksız Node.js backend:
 *  - Derlenmiş oyunu sunar (dist/)
 *  - Kullanıcı hesabı & oturum yönetimi (/api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me)
 *  - Hesaba özel oyun kayıtları (GET/POST /api/save → server/data/saves/<kullanıcı>.json)
 */
import { createServer } from 'node:http'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
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
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
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
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > maxBytes) throw new HttpError(413, 'İstek boyutu çok büyük.')
  }
  return body
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
  const sessions = await readJson(sessionsFile, {})
  const sess = sessions[token]
  if (!sess || sess.expiresAt < Date.now()) return null
  const users = await readJson(usersFile, {})
  const u = users[sess.key]
  if (!u) return null
  return { key: sess.key, username: u.username, token }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')

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
        const users = await readJson(usersFile, {})
        if (users[key]) throw new HttpError(409, 'Bu kullanıcı adı zaten alınmış.')
        const salt = randomBytes(16).toString('hex')
        users[key] = {
          username,
          salt,
          passwordHash: hashPassword(password, salt),
          createdAt: Date.now(),
        }
        await writeJson(usersFile, users)
        const sessions = await readJson(sessionsFile, {})
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
      const key = username.toLowerCase()
      const users = await readJson(usersFile, {})
      const user = users[key]
      if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
        throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı.')
      }
      const token = await serialized(async () => {
        const sessions = await readJson(sessionsFile, {})
        const now = Date.now()
        for (const [k, s] of Object.entries(sessions)) {
          if (!s || s.expiresAt < now) delete sessions[k]
        }
        const tok = randomBytes(32).toString('hex')
        sessions[tok] = { key, expiresAt: now + SESSION_TTL_MS }
        await writeJson(sessionsFile, sessions)
        return tok
      })
      const save = await readFile(savePathForUser(key), 'utf8').catch(() => 'null')
      sendJson(
        res,
        200,
        { user: { username: user.username }, save: JSON.parse(save) },
        { 'Set-Cookie': makeCookie(token, Math.floor(SESSION_TTL_MS / 1000)) },
      )
      return
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE]
      if (token) {
        await serialized(async () => {
          const sessions = await readJson(sessionsFile, {})
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
        try {
          JSON.parse(body)
        } catch {
          throw new HttpError(400, 'Geçersiz kayıt verisi.')
        }
        await serialized(async () => {
          await mkdir(savesDir, { recursive: true })
          await writeFile(saveFile, body, 'utf8')
        })
        res.writeHead(204).end()
        return
      }
      const data = await readFile(saveFile, 'utf8').catch(() => 'null')
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(data)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      throw new HttpError(404, 'API uç noktası bulunamadı.')
    }

    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dist, rel === '/' || rel === '\\' ? 'index.html' : rel)
    if (!file.startsWith(dist)) throw new HttpError(403, 'Forbidden')
    const data = await readFile(file).catch(() => readFile(join(dist, 'index.html')))
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'text/html; charset=utf-8' }).end(data)
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message })
      return
    }
    res.writeHead(400).end('Bad request')
  }
}).listen(port, () => console.log(`NasaGame sunucusu: http://localhost:${port}`))
