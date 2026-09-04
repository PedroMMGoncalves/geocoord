/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // The same system as the sibling dji-mission-planner - a slate ground
        // and a single accent - with GeoCoord's own green in place of its blue,
        // lightened to work on dark: the #1f7a4d of the Streamlit theme has too
        // little contrast for text here.
        panel: '#020617',
        surface: '#0f172a',
        edge: '#1e293b',
        accent: '#34d399',
      },
    },
  },
  plugins: [],
}
