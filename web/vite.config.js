import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The version comes from package.json so the header can say which build is
// running without there being a second place to keep it up to date.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// base = the repository name: GitHub Pages serves this at
// https://pedrommgoncalves.github.io/geocoord/, not at the domain root.
export default defineConfig({
  plugins: [
    react(),
    // The page works without a network once it has been opened. Everything it
    // does already happens in the browser; what needed the network was the
    // page itself. A service worker keeps a copy of every file the build
    // makes - the code, the spreadsheet and shapefile libraries fetched on
    // demand, DGT's two grids, the fonts - and answers from it offline. Only
    // the map's background needs the network: its tiles are Esri's and
    // OpenTopoMap's, whose terms do not allow copying them in bulk.
    VitePWA({
      // A new version waits for the user to say so (UpdateNotice.jsx). Taking
      // it on its own reloads the page, and a conversion half reviewed with it.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'GeoCoord',
        short_name: 'GeoCoord',
        description: 'Conversor de coordenadas para dados de campo - LNEG',
        lang: 'pt',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#0a0e14',
        theme_color: '#0a0e14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Every file the build writes, the grids included: a file in Datum
        // Lisboa converted offline needs them as much as the code.
        globPatterns: ['**/*.{js,css,html,woff,woff2,gsb,png}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  base: '/geocoord/',
  define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
})
