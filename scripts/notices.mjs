// Writes THIRD_PARTY_NOTICES.md: every package shipped with the tool, its
// version and its licence, read from the installed packages.
//
//   node scripts/notices.mjs           # write the file
//   node scripts/notices.mjs --check   # fail if the file is out of date
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((path) => path && relative(root, path) !== '');
const seen = new Map();
for (const path of paths) {
  const meta = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const licence = typeof meta.license === 'string' ? meta.license : 'NOT DECLARED';
  seen.set(`${meta.name}@${meta.version}`, { name: meta.name, version: meta.version, licence });
}
const rows = [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
const text = `# Third-party notices

ZK-Proofscan is licensed GPL-3.0-or-later (see \`LICENSE\`). It is distributed
with the packages below, each under its own licence. This list is generated
by \`node scripts/notices.mjs\` from the installed production dependencies;
the licence shown is the one each package declares, which has not been
checked against the package's files.

The verification keys in \`artifacts/semaphore-v4/\` are copied from
\`@semaphore-protocol/proof\` 4.14.3 (MIT); its licence is kept beside them.

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
