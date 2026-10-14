import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';

/**
 * Barretenberg's browser build carries its WebAssembly inlined as a data:
 * address, which the page's content security policy does not let it fetch.
 * This emits the same bytes as a file of the page's own and exports its
 * address, which the verifier is then given.
 */
function barretenbergWasm(): Plugin {
  const id = 'virtual:barretenberg-wasm';
  return {
    name: 'barretenberg-wasm',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return undefined;
      const browserIndex = createRequire(import.meta.url).resolve('@aztec/bb.js').replace(/dest\/node(-cjs)?\/index\.js$/, 'dest/browser/index.js');
      const inlined = readFileSync(browserIndex.replace(/index\.js$/, 'barretenberg_wasm/fetch_code/browser/barretenberg.js'), 'utf8');
      const match = /"data:application\/gzip;base64,([A-Za-z0-9+/=]+)"/.exec(inlined);
      if (match === null) throw new Error('could not find the WebAssembly inlined in @aztec/bb.js');
      const reference = this.emitFile({ type: 'asset', name: 'barretenberg.wasm.gz', source: Buffer.from(match[1]!, 'base64') });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}

export default defineConfig({
  root: 'web',
  base: './',
  // Bundled files are fetched as real files so their exact bytes can be hashed.
  build: { outDir: '../dist-web', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es', plugins: () => [barretenbergWasm()] },
});
