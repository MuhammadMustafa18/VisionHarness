/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Google Sans"', '"Google Sans Text"', '"Product Sans"', 'sans-serif'],
        mono: ['"Google Sans Code"', 'monospace'],
      },
    },
  },
  plugins: [],
}

