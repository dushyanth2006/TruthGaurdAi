/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F7FAFF',
        surface: '#FFFFFF',
        raised: '#FFFFFF',
        fg: '#102A43', // deep navy text
        muted: '#36506D', // body text
        faint: '#64748B', // secondary metadata
        ok: '#047857', // Real verdict
        line: '#102A43', // used at low opacity for hairlines & hovers
        accent: '#2563EB', // royal blue primary
        'accent-soft': '#DBEAFE',
        coral: '#B42318', // Fake only (readable red)
        amber: '#A16207', // Unverified only (readable amber)
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
