import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The app must be fully playable offline after one visit (PRD §3.5).
// Everything is code — no runtime fonts, images, or audio — so precaching the
// build output is sufficient.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Arrow Maze',
        short_name: 'ArrowMaze',
        description: 'Offline arrow maze puzzle.',
        theme_color: '#151527',
        background_color: '#151527',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
