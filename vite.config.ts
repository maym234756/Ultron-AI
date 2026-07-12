import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Ultron AI',
        short_name: 'Ultron',
        description: 'Your local AI assistant — answer, inspect, operate, and remember.',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'New Chat',
            short_name: 'Chat',
            description: 'Start a new Ultron chat session',
            url: '/?new=1',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Voice Mode',
            short_name: 'Voice',
            description: 'Open Ultron in voice conversation mode',
            url: '/?voice=1',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    watch: {
      ignored: ['**/desktop-release/**', '**/release/**', '**/dist-electron/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
