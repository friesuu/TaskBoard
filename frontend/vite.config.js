import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Settings for the tests (npm test)
  test: {
    environment: 'jsdom', // a pretend browser, so components can render without a real one
    setupFiles: './src/test/setup.js', // runs before every test file
    // At most 4 test files at once. Each one runs its own pretend browser; one per processor thread (the
    // default) overloads the laptop, and tests then fail at random by running out of time. It's no slower.
    maxWorkers: 4,
  },
})
