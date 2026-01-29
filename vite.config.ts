import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Note: for GitHub Pages you may want to set base to "/<repo-name>/".
// Keeping "./" makes local previews and static hosting simpler.
export default defineConfig({
  base: './',
  plugins: [react()],
})
