import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Fitness',
        short_name: 'Fitness',
        description: 'Persönliche Trainings-App',
        lang: 'de-CH',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Expose exactly these two public Neon URLs (pulled into .env.local by the Neon CLI).
  // Never widen this to a generic prefix: .env.local also holds DATABASE_URL.
  envPrefix: ['VITE_', 'NEON_AUTH_BASE_URL', 'NEON_DATA_API_URL'],
  server: { port: 5173, strictPort: true },
})
