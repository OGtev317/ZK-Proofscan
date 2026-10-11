import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Compiles `dist` once, before any test file starts the command line or the tool server. */
export default function build(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { cwd: root });
}
