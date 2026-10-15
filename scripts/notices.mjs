// Writes THIRD_PARTY_NOTICES.md: every package shipped with the tool, its
// version and its licence, read from package-lock.json. The lockfile lists
// the optional packages for every platform, so the result is the same on
// every machine; the installed folder is not, and holds only one platform's.
//
//   node scripts/notices.mjs           # write the file
//   node scripts/notices.mjs --check   # fail if the file is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const seen = new Map();
for (const [path, meta] of Object.entries(lock.packages)) {
  // The empty path is this project; `dev` marks packages used only for development.
  if (path === '' || meta.dev === true) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const licence = typeof meta.license === 'string' ? meta.license : 'NOT DECLARED';
  seen.set(`${name}@${meta.version}`, { name, version: meta.version, licence });
}
const rows = [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
const text = `# Third-party notices

LumenLenz is licensed GPL-3.0-or-later (see \`LICENSE\`). It is distributed
with the packages below, each under its own licence. This list is generated
by \`node scripts/notices.mjs\` from the production dependencies in
\`package-lock.json\`, including the optional packages for every platform;
the licence shown is the one each package declares, which has not been
checked against the package's files.

The verification keys in \`artifacts/semaphore-v4/\` are copied from
\`@semaphore-protocol/proof\` 4.14.3 (MIT); its licence is kept beside them.

The Rust crates compiled into \`artifacts/ark-groth16/ark-groth16.wasm\`,
arkworks' Groth16 verifier, are listed with their licences in
\`artifacts/ark-groth16/README.md\`: MIT, Apache-2.0, Zlib or Unlicense, as
each declares; arkworks' own licence files are beside it.

| Package | Version | Declared licence |
| --- | --- | --- |
${rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`).join('\n')}
`;
const target = join(root, 'THIRD_PARTY_NOTICES.md');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text) {
    console.error('THIRD_PARTY_NOTICES.md is out of date: run node scripts/notices.mjs');
    process.exitCode = 1;
  }
} else {
  writeFileSync(target, text);
  console.log(`${rows.length} packages`);
}
