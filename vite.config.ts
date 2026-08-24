import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Everything is code — no runtime fonts, images, or audio — so precaching the
// build output is enough to make the app playable offline after one visit.
// GitHub Pages serves this from /<repo>/, so the base path comes from the
// environment at build time. Dev and any root-hosted deploy use '/'.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['bench.html'],
        navigateFallback: `${base}index.html`,
        // Without this the navigation route answers every path with the app
        // shell, so a standalone page is unreachable on any device that has
        // already installed the worker. The denylist is matched against
        // pathname + search, so the query string has to be allowed for.
        navigateFallbackDenylist: [/bench\.html(\?|$)/],
      },
      manifest: {
        name: 'Arrow Maze',
        short_name: 'ArrowMaze',
        description: 'Offline arrow maze puzzle.',
        theme_color: '#151527',
        background_color: '#151527',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
