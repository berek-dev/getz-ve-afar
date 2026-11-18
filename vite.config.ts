import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // three.js is one lazy chunk (~540 kB, ~140 kB gzipped), loaded only by the 3D views
  build: { chunkSizeWarningLimit: 600 },
  server: {
    // `npm run dev:api` serves the Pages Functions (API + D1) on 8788
    proxy: { '/api': 'http://localhost:8788' },
  },
});
