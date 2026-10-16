import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';

/**
 * Barretenberg's browser builds carry their WebAssembly inlined as a data:
 * address, which the page's content security policy does not let them
 * fetch. This emits the same bytes as a file of the page's own and exports
 * its address, which the verifier is then given: `virtual:barretenberg-wasm`
 * for 5.2.1 and `virtual:barretenberg-legacy-wasm` for 0.87.0.
 */
function barretenbergWasm(): Plugin {
  const sources: Record<string, { pkg: string; file: string; name: string }> = {
    'virtual:barretenberg-wasm': { pkg: '@aztec/bb.js', file: 'barretenberg_wasm/fetch_code/browser/barretenberg.js', name: 'barretenberg.wasm.gz' },
    'virtual:barretenberg-legacy-wasm': { pkg: 'aztec-bb-js-0-87-0', file: 'barretenberg.js', name: 'barretenberg-legacy.wasm.gz' },
  };
  return {
    name: 'barretenberg-wasm',
    resolveId: (source) => (source in sources ? `\0${source}` : undefined),
    load(resolved) {
      const source = sources[resolved.replace(/^\0/, '')];
      if (!resolved.startsWith('\0') || source === undefined) return undefined;
      const browserDir = createRequire(import.meta.url).resolve(source.pkg).replace(/dest\/node(-cjs)?\/index\.js$/, 'dest/browser/');
      const inlined = readFileSync(browserDir + source.file, 'utf8');
      const match = /"data:application\/gzip;base64,([A-Za-z0-9+/=]+)"/.exec(inlined);
      if (match === null) throw new Error(`could not find the WebAssembly inlined in ${source.pkg}`);
      const reference = this.emitFile({ type: 'asset', name: source.name, source: Buffer.from(match[1]!, 'base64') });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}

export default defineConfig({
  root: 'web',
  base: './',
  // Bundled files are fetched as real files so their exact bytes can be hashed.
  build: { outDir: '../dist-web', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, rollupOptions: { input: ['web/index.html', 'web/integrations/index.html'] } },
  worker: { format: 'es', plugins: () => [barretenbergWasm()] },
});
