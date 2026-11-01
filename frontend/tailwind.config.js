/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: { DEFAULT: '#FDF8EC', 50: '#FEFCF6', 100: '#FDF8EC', 200: '#F7EDD6' },
        burgundy: { DEFAULT: '#7A1118', 50: '#FBEFF0', 100: '#F3D3D5', 500: '#9B1B24', 600: '#7A1118', 700: '#620D13', 800: '#4A0A0F' },
        gold: { DEFAULT: '#C58F3C', 300: '#E6C07B', 400: '#D8A957', 500: '#C58F3C', 600: '#A8752A' },
        brand: { brown: '#7A2E14' },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
