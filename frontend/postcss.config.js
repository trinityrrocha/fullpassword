import spacingCompatibility from './tailwind-spacing-compat.js';
export default {
  // Tailwind compilation/imports/prefixing are owned by @tailwindcss/vite.
  plugins: [spacingCompatibility()],
}
