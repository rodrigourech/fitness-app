import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH is set by the GitHub Pages build (e.g. /fitness-app-web/); locally the app runs at /
const base = process.env.BASE_PATH ?? '/'
// APP_VARIANT=beta: test build of a feature branch (see .github/workflows/deploy.yml)
const beta = process.env.APP_VARIANT === 'beta'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: beta ? 'Fitness App Beta' : 'Fitness App',
        short_name: beta ? 'Fitness Beta' : 'Fitness',
        description: 'Personal workout log',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The beta build lives under <base>beta/ with its own service worker; never answer it with this app
        navigateFallbackDenylist: beta ? [] : [/\/beta\//],
      },
    }),
  ],
  // Expose exactly these two public Neon URLs (pulled into .env.local by the Neon CLI).
  // Never widen this to a generic prefix: .env.local also holds DATABASE_URL.
  envPrefix: ['VITE_', 'NEON_AUTH_BASE_URL', 'NEON_DATA_API_URL'],
  server: { port: 5173, strictPort: true },
})
