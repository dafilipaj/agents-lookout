import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  test: {
    // Off: the on-disk module cache keys a module by its own text, so the design-system and icon
    // guards' `import.meta.glob` kept the file list of when the guard last changed, and passed while
    // files added since broke it.
    fsModuleCache: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.mjs'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['web/src/test/setup.ts'],
          // A `?raw` CSS import is the file's text (tests read index.css's tokens); other CSS stays empty.
          css: { include: [/\.css\?raw$/] },
        },
      },
    ],
  },
});
