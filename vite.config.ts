import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Geliştirmede /api istekleri Node.js sunucusuna (npm run server) yönlenir.
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://localhost:8787' } } })
