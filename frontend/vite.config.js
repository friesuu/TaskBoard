import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Settings for the tests (npm test)
  test: {
    environment: 'jsdom', // a pretend browser, so components can render without a real one
    setupFiles: './src/test/setup.js', // runs before every test file
  },
})
