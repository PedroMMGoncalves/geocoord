import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The version comes from package.json so the header can say which build is
// running without there being a second place to keep it up to date.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// base = the repository name: GitHub Pages serves this at
// https://pedrommgoncalves.github.io/geocoord/, not at the domain root.
export default defineConfig({
  plugins: [react()],
  base: '/geocoord/',
  define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
})
