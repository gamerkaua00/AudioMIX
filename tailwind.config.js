/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#14100D', // fundo principal (preto quente, não azulado)
          900: '#1C1712', // cartões
          800: '#241E17', // botões/elementos elevados
          700: '#2E271D', // hover/elevado ainda mais
        },
        ivory: {
          DEFAULT: '#EDE6D6', // "tecla branca" - texto/elementos claros
          dim: '#B8AFA0',      // texto secundário quente
          faint: '#6E655A',    // texto terciário/desabilitado
        },
        copper: {
          300: '#E3A579',
          400: '#D9824F',
          500: '#C1652E', // acento principal
          600: '#A8551F',
          950: '#2A1810',
        },
      },
      fontFamily: {
        display: ['"Roboto Slab"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}