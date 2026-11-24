// Re-packs ../pwa-kit into vendor/ (Vercel clones only this repository, so pwa-kit is vendored as a tarball).
// Run as: npm run pwa-kit:refresh, then npm install, then commit vendor/ and package-lock.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// PWA_KIT_DIR packs another checkout of the kit (a branch's worktree or export) instead of the sibling folder
const kit = process.env.PWA_KIT_DIR ? resolve(process.env.PWA_KIT_DIR) : resolve(root, '..', 'pwa-kit');
const vendor = join(root, 'vendor');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

mkdirSync(vendor, { recursive: true });
run(['run', 'build'], kit);
for (const f of readdirSync(vendor)) if (/^pwa-kit-.*\.tgz$/.test(f)) rmSync(join(vendor, f));
run(['pack', '--pack-destination', vendor], kit);

const tgz = readdirSync(vendor).find((f) => /^pwa-kit-.*\.tgz$/.test(f));
if (!tgz) throw new Error('npm pack wrote no tarball into vendor/');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
(pkg.devDependencies?.['pwa-kit'] ? pkg.devDependencies : pkg.dependencies)['pwa-kit'] =`file:vendor/${tgz}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`pwa-kit vendored as vendor/${tgz}; now run npm install and commit vendor/, package.json, package-lock.json`);
