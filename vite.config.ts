import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * GitHub Pages:
 * - Relative base (`./`) works for project pages without knowing the repo name.
 * - Override with VITE_BASE=/repo-name/ if you prefer absolute paths.
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || './',
  server: {
    open: true,
    port: 5173,
  },
  preview: {
    open: true,
    port: 4173,
  },
})
