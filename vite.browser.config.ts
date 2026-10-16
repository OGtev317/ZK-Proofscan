import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist-browser', emptyOutDir: true, lib: { entry: 'src/browser/index.ts', formats: ['es'], fileName: () => 'lumenlenz-report.js' }, target: 'es2022' },
});
