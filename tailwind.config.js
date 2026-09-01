/** @type {import('tailwindcss').Config} */
const withOpacity = (v) => ({ opacityValue }) =>
  opacityValue === undefined ? `rgb(var(${v}))` : `rgb(var(${v}) / ${opacityValue})`

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: withOpacity('--c-canvas'),
        surface: withOpacity('--c-surface'),
        raised: withOpacity('--c-raised'),
        sunken: withOpacity('--c-sunken'),
        line: withOpacity('--c-line'),
        'line-strong': withOpacity('--c-line-strong'),
        ink: withOpacity('--c-ink'),
        'ink-2': withOpacity('--c-ink-2'),
        'ink-3': withOpacity('--c-ink-3'),
        brand: {
          50: withOpacity('--c-brand-50'),
          100: withOpacity('--c-brand-100'),
          200: withOpacity('--c-brand-200'),
          300: withOpacity('--c-brand-300'),
          400: withOpacity('--c-brand-400'),
          500: withOpacity('--c-brand-500'),
          600: withOpacity('--c-brand-600'),
          700: withOpacity('--c-brand-700'),
          DEFAULT: withOpacity('--c-brand-500'),
        },
        saffron: { DEFAULT: withOpacity('--c-saffron'), soft: withOpacity('--c-saffron-soft') },
        ok: { DEFAULT: withOpacity('--c-ok'), soft: withOpacity('--c-ok-soft') },
        warn: { DEFAULT: withOpacity('--c-warn'), soft: withOpacity('--c-warn-soft') },
        risk: { DEFAULT: withOpacity('--c-risk'), soft: withOpacity('--c-risk-soft') },
        info: { DEFAULT: withOpacity('--c-info'), soft: withOpacity('--c-info-soft') },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
      },
      borderRadius: { xl: '0.75rem', '2xl': '1rem', '3xl': '1.375rem' },
      boxShadow: {
        card: '0 1px 2px 0 rgb(var(--c-shadow) / 0.05), 0 1px 3px 0 rgb(var(--c-shadow) / 0.04)',
        lift: '0 2px 4px -1px rgb(var(--c-shadow) / 0.06), 0 8px 20px -6px rgb(var(--c-shadow) / 0.12)',
        pop: '0 4px 8px -2px rgb(var(--c-shadow) / 0.08), 0 18px 44px -12px rgb(var(--c-shadow) / 0.22)',
        inset: 'inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': { from: { opacity: '0', transform: 'translateY(4px) scale(.985)' }, to: { opacity: '1', transform: 'none' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-left': { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'bar-grow': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out both',
        'scale-in': 'scale-in .16s cubic-bezier(.16,1,.3,1) both',
        'slide-up': 'slide-up .28s cubic-bezier(.16,1,.3,1) both',
        'slide-left': 'slide-left .24s cubic-bezier(.16,1,.3,1) both',
        'bar-grow': 'bar-grow .6s cubic-bezier(.16,1,.3,1) both',
      },
    },
  },
  plugins: [],
}
