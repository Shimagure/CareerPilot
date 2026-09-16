/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Vision-UI-inspired violet primary (#7551ff)
        brand: {
          50: '#f4f2ff',
          100: '#e9e4ff',
          200: '#d5c9ff',
          300: '#b8a3ff',
          400: '#9c79ff',
          500: '#8a5fff',
          600: '#7551ff',
          700: '#6237e6',
          800: '#522cc2',
          900: '#402a99',
          950: '#251a59',
        },
        // Deep navy dashboard surfaces
        night: {
          950: '#060912',
          900: '#0a0f1e',
          850: '#0e1424',
          800: '#121829',
          700: '#1a2236',
          600: '#232d47',
          500: '#2e3a5c',
        },
        accent: {
          cyan: '#49a3f1',
          blue: '#6ec8ff',
          pink: '#f8618c',
          rose: '#ff80b4',
          violet: '#a855f7',
        },
        surface: {
          light: '#ffffff',
          dark: '#0a0f1e',
        },
        border: {
          light: '#e5e4e7',
          dark: '#222a45',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'Segoe UI', 'Inter', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
        display: ['system-ui', 'Segoe UI', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 10px 30px -12px rgba(117,81,255,0.14)',
        'card-hover': '0 2px 6px rgba(0,0,0,0.45), 0 16px 40px -12px rgba(117,81,255,0.28)',
        'glow-brand': '0 0 0 1px rgba(117,81,255,0.35), 0 10px 40px -8px rgba(117,81,255,0.55)',
        'glow-cyan': '0 0 0 1px rgba(73,163,241,0.35), 0 10px 40px -8px rgba(73,163,241,0.5)',
        'glow-soft': '0 0 60px -24px rgba(117,81,255,0.35)',
        'glow-pink': '0 0 0 1px rgba(248,97,140,0.35), 0 10px 40px -8px rgba(248,97,140,0.5)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #7551ff 0%, #8a5fff 50%, #49a3f1 100%)',
        'brand-cta': 'linear-gradient(135deg, #7551ff 0%, #a855f7 100%)',
        'cyan-cta': 'linear-gradient(135deg, #49a3f1 0%, #6ec8ff 100%)',
        'pink-cta': 'linear-gradient(135deg, #f8618c 0%, #ff80b4 100%)',
        'nav-active': 'linear-gradient(90deg, rgba(117,81,255,0.28) 0%, rgba(117,81,255,0.08) 100%)',
      },
      borderRadius: {
        '2xl': '1.1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.35s ease-out both',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'float-slow': 'floatSlow 12s ease-in-out infinite',
        'shine': 'shine 2.5s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(30px, -30px, 0)' },
        },
        shine: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
      },
    },
  },
  plugins: [],
}