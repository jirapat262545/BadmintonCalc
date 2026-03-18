/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'cursive'],
        body: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        court: {
          950: '#050e07',
          900: '#0a1a0f',
          800: '#0f2a17',
          700: '#173d21',
          600: '#1f5229',
        },
        lime: {
          400: '#a3e635',
          500: '#84cc16',
        },
      },
    },
  },
  plugins: [],
}
