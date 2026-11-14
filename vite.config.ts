import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Geliştirme başlatıcısı API portunu seçer; eski/başka servislerin yanıtlarını kullanmayız.
const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const apiPort = runtime.process?.env?.NASA_API_PORT ?? '8787'

export default defineConfig({ plugins: [react()], server: { proxy: { '/api': `http://127.0.0.1:${apiPort}` } } })
