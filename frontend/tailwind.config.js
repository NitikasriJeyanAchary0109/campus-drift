/** @type {import('tailwindcss').Config} */
// The `dw` colours, shadows and fonts mirror src/components/ui/pixel/tokens.css, which is the single source of the values.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // one system sans for everything; the old display names stay as aliases so earlier pages pick it up
        pixel: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        retro: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        display: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        title: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        body: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          900: '#0c4a6e',
        },
        dw: {
          ink: 'var(--dw-ink)',
          navy: 'var(--dw-navy)',
          cream: 'var(--dw-cream)',
          'cream-2': 'var(--dw-cream-2)',
          paper: 'var(--dw-paper)',
          sky: 'var(--dw-sky)',
          'sky-2': 'var(--dw-sky-2)',
          'sky-pale': 'var(--dw-sky-pale)',
          grass: 'var(--dw-grass)',
          'grass-dark': 'var(--dw-grass-dark)',
          brick: 'var(--dw-brick)',
          'brick-dark': 'var(--dw-brick-dark)',
          mortar: 'var(--dw-mortar)',
          yellow: 'var(--dw-yellow)',
          'yellow-dark': 'var(--dw-yellow-dark)',
          red: 'var(--dw-red)',
          'red-dark': 'var(--dw-red-dark)',
          'red-ui': 'var(--dw-red-ui)',
          crimson: 'var(--dw-crimson)',
          orange: 'var(--dw-orange)',
          'orange-dark': 'var(--dw-orange-dark)',
          blue: 'var(--dw-blue)',
          'blue-dark': 'var(--dw-blue-dark)',
          'blue-ui': 'var(--dw-blue-ui)',
          green: 'var(--dw-green)',
          'green-dark': 'var(--dw-green-dark)',
          gray: 'var(--dw-gray)',
          'gray-light': 'var(--dw-gray-light)',
          'gray-dark': 'var(--dw-gray-dark)',
          muted: 'var(--dw-text-muted)',
        },
      },
      // outline scale
      borderWidth: { 'pxl-1': '1px', 'pxl-2': '1px', 'pxl-3': '1px' },
      // hard-offset shadows, no blur
      boxShadow: {
        'pxl-1': 'var(--pxl-shadow-1)',
        'pxl-2': 'var(--pxl-shadow-2)',
        'pxl-3': 'var(--pxl-shadow-3)',
      },
      // 4px spacing steps under their own names (Tailwind's own numeric scale is untouched)
      spacing: { 'pxl-1': '4px', 'pxl-2': '8px', 'pxl-3': '12px', 'pxl-4': '16px', 'pxl-5': '24px', 'pxl-6': '32px' },
    },
  },
  plugins: [],
}
