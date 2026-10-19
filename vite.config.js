import { defineConfig, loadEnv } from 'vite'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import ttsHandler from './api/tts.js'

function localTtsApi() {
  return {
    name: 'local-tts-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      if (!process.env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY) {
        process.env.ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY
      }

      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/tts') {
          next()
          return
        }

        if (req.method !== 'POST') {
          ttsHandler(req, res)
          return
        }

        const chunks = []
        let bodySize = 0
        let tooLarge = false
        req.on('data', chunk => {
          bodySize += chunk.length
          if (bodySize > 64 * 1024) {
            tooLarge = true
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          if (tooLarge) {
            res.statusCode = 413
            res.end('{"error":"Request body too large."}')
            return
          }

          try {
            req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            res.statusCode = 400
            res.end('{"error":"Invalid JSON body."}')
            return
          }
          ttsHandler(req, res)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    localTtsApi(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo.png', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Orchard Bible',
        short_name: 'Orchard',
        description: 'Daily Bible reading tracker for Orchard Church',
        theme_color: '#f8f6ef',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
