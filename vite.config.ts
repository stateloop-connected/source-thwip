import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built dist/ works from a static file server, from
  // Vercel, and from Electron's file:// protocol without reconfiguration.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // One chunk. The whole point is a single fast download.
        manualChunks: undefined,
      },
    },
  },
});
