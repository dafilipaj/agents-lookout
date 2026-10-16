import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEFAULT_DEV_PORT, DEFAULT_PORT } from './shared/defaults.ts';

const serverPort = Number(process.env.LOOKOUT_PORT ?? DEFAULT_PORT);
const devPort = Number(process.env.LOOKOUT_DEV_PORT ?? DEFAULT_DEV_PORT);

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    proxy: {
      // changeOrigin rewrites Host to the server's own, which it checks; the browser's
      // Origin header is passed through and the server allows the dev origin explicitly.
      '/api': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: true,
        // When the server restarts, end the browser's side of a proxied event stream too, so the
        // UI's EventSource reconnects instead of waiting on a dead stream.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => {
              if (!res.writableEnded) res.destroy();
            });
          });
        },
      },
    },
  },
});
