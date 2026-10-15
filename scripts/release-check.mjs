#!/usr/bin/env node
// Checks the package is ready to publish, without publishing anything:
//
//   npm run release:check            # everything
//   npm run release:check -- --quick # skip the type check and the test suite
//
// 1. A clean build, the type check and the test suite.
// 2. The versions agree: package.json, the version reports carry, and the
//    lockfile.
// 3. THIRD_PARTY_NOTICES.md is up to date with the lockfile.
// 4. What `npm pack` would publish: the entry points and notices are in it;
//    no tests, fixtures, scripts, environment files, keys or the large
//    reference string; and it is a sensible size.
// 5. The packed tarball, installed into an empty folder with nothing else
//    from this checkout, works as a library and from its three commands,
//    checking a proof offline.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const quick = process.argv.includes('--quick');
const failures = [];
const step = (name) => console.log(`\n== ${name}`);
const ok = (what) => console.log(`  ok   ${what}`);
const fail = (what) => (failures.push(what), console.log(`  FAIL ${what}`));
const expectThat = (condition, what) => (condition ? ok(what) : fail(what));
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });

step('build, type check and tests');
rmSync(join(root, 'dist'), { recursive: true, force: true });
run('npm', ['run', '-s', 'build']);
ok('clean build');
if (quick) console.log('  --   type check and tests skipped (--quick)');
else {
  run('npm', ['run', '-s', 'typecheck']);
  ok('type check');
  run('npm', ['test', '--', '--reporter=dot'], { stdio: ['ignore', 'ignore', 'inherit'] });
  ok('test suite');
}

step('versions');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const { TOOL } = await import(`${root}dist/report.js`);
expectThat(TOOL.name === pkg.name && TOOL.version === pkg.version, `reports name ${TOOL.name} ${TOOL.version}, package is ${pkg.name} ${pkg.version}`);
expectThat(lock.version === pkg.version && lock.packages[''].version === pkg.version, `lockfile version ${lock.version}`);
expectThat(pkg.private !== true, 'package is not marked private');
expectThat(/experimental/i.test(pkg.description), 'package description says experimental');

step('notices');
expectThat(spawnSync('node', ['scripts/notices.mjs', '--check'], { cwd: root }).status === 0, 'THIRD_PARTY_NOTICES.md matches the lockfile');

step('what would be published');
const packedJson = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']));
// npm 10 answers with a list, npm 11 and later with an object keyed by name.
const packed = Array.isArray(packedJson) ? packedJson[0] : packedJson[pkg.name];
const files = packed.files.map((file) => file.path);
for (const needed of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/DEVELOPERS.md', 'dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'dist/mcp.js', 'registry/keys.json']) expectThat(files.includes(needed), `includes ${needed}`);
const forbidden = [/^tests\//, /^scripts\//, /^web\//, /^src\//, /(^|\/)\.env/, /\.test\./, /\.(pem|key)$/, /bn254_g1_compressed\.dat$/, /grumpkin_g1_v2\.flat\.dat$/, /(^|\/)node_modules\//];
const leaked = files.filter((path) => forbidden.some((pattern) => pattern.test(path)));
expectThat(leaked.length === 0, leaked.length === 0 ? 'no tests, sources, scripts, environment files, keys or large reference strings' : `should not ship: ${leaked.slice(0, 8).join(', ')}`);
const local = files.filter((path) => /\/(Users|home)\/[A-Za-z0-9._-]+\//.test(readFileSync(join(root, path), 'latin1')));
expectThat(local.length === 0, local.length === 0 ? 'no local machine paths in any packed file' : `local paths in: ${local.join(', ')}`);
expectThat(packed.size < 2_000_000, `packed size ${(packed.size / 1000).toFixed(1)} kB, ${files.length} files`);

step('a fresh install, outside this checkout');
const scratch = mkdtempSync(join(tmpdir(), 'lumenlenz-release-'));
try {
  const tarball = join(scratch, run('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', scratch]).trim().split('\n').pop());
  const app = join(scratch, 'app');
  run('mkdir', [app]);
  writeFileSync(join(app, 'package.json'), '{"name":"release-check","private":true,"type":"module"}\n');
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', tarball], { cwd: app });
  ok('installs from the packed tarball');
  const proof = join(root, 'tests/fixtures/semaphore-v4-valid.json');
  writeFileSync(
    join(app, 'use.mjs'),
    `import { readFileSync } from 'node:fs';
import { checkProof, renderReport, TOOL, stop } from 'lumenlenz';
const report = await checkProof({ proof: readFileSync(${JSON.stringify(proof)}, 'utf8') });
await stop();
if (report.outcome !== 'valid' || !renderReport(report).startsWith('Claim:')) { console.error(report); process.exit(1); }
console.log(TOOL.version);
`,
  );
  expectThat(run('node', ['use.mjs'], { cwd: app }).trim() === pkg.version, 'the library checks a proof');
  for (const command of ['lumenlenz', 'stellar-lumenlenz']) {
    const done = spawnSync(join(app, 'node_modules/.bin', command), ['check', proof], { cwd: app, encoding: 'utf8' });
    expectThat(done.status === 0 && done.stdout.startsWith('Claim:'), `${command} check exits 0 for a valid proof`);
  }
  // Noir proofs need only the small setup point the package ships, not the large reference string it leaves out.
  for (const fixture of ['noir/multiplier-evm', 'noir-legacy/multiplier-keccak']) {
    const base = join(root, 'tests/fixtures', fixture);
    const done = spawnSync(join(app, 'node_modules/.bin', 'lumenlenz'), ['check', `${base}.proof`, '--public', `${base}.public_inputs`, '--key', `${base}.vk`, '--json'], { cwd: app, encoding: 'utf8' });
    expectThat(done.status === 0 && JSON.parse(done.stdout).outcome === 'valid', `checks the Noir proof ${fixture} with the packaged files only`);
  }
  const mcp = spawnSync(join(app, 'node_modules/.bin', 'lumenlenz-mcp'), [], { cwd: app, encoding: 'utf8', input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'release-check', version: '0' } } })}\n`, timeout: 20_000 });
  expectThat(/"serverInfo"/.test(mcp.stdout), 'lumenlenz-mcp answers an MCP initialize');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(failures.length === 0 ? `\nRelease check passed for ${pkg.name} ${pkg.version}.` : `\nRelease check FAILED: ${failures.length} problem(s).`);
process.exit(failures.length === 0 ? 0 : 1);
