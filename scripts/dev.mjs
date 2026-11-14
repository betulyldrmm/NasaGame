import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const apiHost = '127.0.0.1'
let apiProcess = null
let viteProcess = null
let shuttingDown = false

async function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, apiHost, () => server.close(() => resolve(true)))
  })
}

async function isGameApi(port) {
  try {
    const response = await fetch(`http://${apiHost}:${port}/api/auth/me`, { signal: AbortSignal.timeout(600) })
    if (!response.headers.get('content-type')?.includes('application/json')) return false
    const data = await response.json()
    return Object.hasOwn(data, 'user')
  } catch {
    return false
  }
}

async function waitForApi(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isGameApi(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

async function chooseApiPort() {
  for (let port = 8787; port < 8887; port += 1) {
    if (await isGameApi(port)) {
      console.log(`Mevcut NasaGame hesap API'si kullanılıyor: http://${apiHost}:${port}`)
      return port
    }
    if (!(await isFree(port))) {
      console.log(`${port} portunda başka bir servis var; sonraki port deneniyor.`)
      continue
    }

    apiProcess = spawn(process.execPath, [join(root, 'server', 'index.mjs')], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit',
    })
    if (await waitForApi(port)) return port
    throw new Error(`Hesap API sunucusu ${port} portunda başlatılamadı.`)
  }
  throw new Error('Hesap API sunucusu için kullanılabilir port bulunamadı (8787–8886).')
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill()
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill()
  process.exitCode = code
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

try {
  const apiPort = await chooseApiPort()
  viteProcess = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: root,
    env: { ...process.env, NASA_API_PORT: String(apiPort) },
    stdio: 'inherit',
  })
  viteProcess.once('error', (error) => {
    console.error('Vite başlatılamadı:', error.message)
    shutdown(1)
  })
  viteProcess.once('exit', (code) => shutdown(code ?? 0))
  apiProcess?.once('exit', (code) => {
    if (!shuttingDown) {
      console.error(`Hesap API sunucusu kapandı (kod ${code ?? 'bilinmiyor'}).`)
      shutdown(1)
    }
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  shutdown(1)
}
