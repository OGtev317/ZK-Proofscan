import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  // Bundled files are fetched as real files so their exact bytes can be hashed.
  build: { outDir: '../dist-web', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
});
