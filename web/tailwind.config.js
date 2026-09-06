/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // The night chart. A blue-black ground like deep water on a dark
      // basemap, and surfaces that step up from it in cool slate rather than
      // three navy blues 1.3:1 apart, which is what the page had before and
      // is why every card read as a hole in the ground.
      //
      // Colour is rationed by what it means, not by where it is:
      //   green   - the one thing you press (actions, focus)
      //   cyan    - the one thing you read (coordinate readouts)
      //   amber   - look here, a question (rows to review)
      //   red     - could not be used
      // A converted row is neutral. It used to be green too, which left green
      // meaning nothing at all. Every text pair here was checked against its
      // ground and passes WCAG AA; the tightest is 5.1:1.
      colors: {
        ground: '#0a0e14',
        surface: '#10161e',
        raised: '#182029',
        hover: '#1f2933',
        well: '#0c1219',
        edge: '#1e2832',
        'edge-strong': '#2e3a48',
        ink: { DEFAULT: '#e8edf3', 2: '#aab5c2', 3: '#8391a0' },
        accent: { DEFAULT: '#34d399', hi: '#5fe3b1', ink: '#0a0e14' },
        coord: '#86d0f5',
        review: '#f2b649',
        fail: '#ff8f6b',
        'row-review': '#23221e',
        'row-fail': '#241f21',
        banner: '#222321',
        'map-ground': '#0d141c',
        // The old name for the ground, kept so nothing that still says
        // bg-panel breaks. New code says bg-ground.
        panel: '#0a0e14',
      },
      // Material that follows meaning: a key is something you press, a well is
      // something you read out of, a plate is something things sit on. Nothing
      // else gets a shadow.
      boxShadow: {
        key: 'inset 0 1px 0 rgba(255,255,255,.05), 0 1px 1px rgba(0,0,0,.35)',
        well: 'inset 0 1px 3px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.015)',
        plate: 'inset 0 1px 0 rgba(255,255,255,.035), 0 1px 2px rgba(0,0,0,.45), '
          + '0 16px 40px -24px rgba(0,0,0,.7)',
      },
      // Both faces travel with the page (see main.jsx) rather than being
      // fetched from a font service, so the page keeps its promise of talking
      // to nobody. JetBrains Mono for the numbers: a slashed zero, and the
      // same glyphs on every operating system where Consolas, Menlo and
      // DejaVu Sans Mono are three different widths.
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
