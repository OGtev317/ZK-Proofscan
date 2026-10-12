import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  base: './',
  // Bundled files are fetched as real files so their exact bytes can be hashed.
  build: {
    outDir: '../dist-web', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0,
    rollupOptions: { input: {
      verifier: fileURLToPath(new URL('./web/index.html', import.meta.url)),
      submission: fileURLToPath(new URL('./web/submission/index.html', import.meta.url)),
    } },
  },
  worker: { format: 'es' },
});
