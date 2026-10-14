import legacyTheme from './legacy-tailwind-theme.js';
/** Compatibility config: visual tokens stay at the established v3 values. */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: legacyTheme,
  plugins: [],
}

