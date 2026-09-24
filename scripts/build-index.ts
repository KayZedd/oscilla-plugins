/**
 * Builds the registry Oscilla reads (docs: README.md):
 *
 *   dist/<id>-<version>.tar.gz   one archive per plugin in plugins/<id>/
 *   dist/index.json              id, version, apiVersion, permissions, url, sha256
 *
 * Signing (dist/index.json.minisig) is a separate step with the registry's
 * minisign key, done by CI (.github/workflows/release.yml). Oscilla refuses an
 * index whose signature doesn't check out with the key the user added, and
 * any archive whose SHA-256 differs from the signed index.
 *
 *   BASE_URL=https://<owner>.github.io/oscilla-plugins bun scripts/build-index.ts
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const pluginsDir = join(root, 'plugins');
const dist = join(root, 'dist');
const baseUrl = (process.env.BASE_URL ?? 'https://example.invalid/oscilla-plugins').replace(/\/$/, '');

const ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PERMISSIONS = new Set(['player:read', 'player:control', 'page', 'storage', 'network', 'ui', 'media:save']);
const FILE = /^(?!\.)[A-Za-z0-9_.-]+(?:\/(?!\.)[A-Za-z0-9_.-]+)*$/;

interface Manifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  author: string;
  permissions: string[];
  hosts?: string[];
  entry: string;
  styles?: string[];
}

/** The checks Oscilla makes before installing (plugins/manifest.rs), so a
 * broken plugin fails here instead of on users' machines. */
export function checkManifest(m: Manifest, dirName: string): string[] {
  const problems: string[] = [];
  if (!ID.test(m.id) || m.id.length > 100) problems.push(`id ${m.id} is not reverse-DNS`);
  if (m.id !== dirName) problems.push(`folder ${dirName} must be named like the id ${m.id}`);
  if (!SEMVER.test(m.version)) problems.push(`version ${m.version} is not semver`);
  if (m.apiVersion !== 1) problems.push(`apiVersion must be 1`);
  for (const p of m.permissions ?? []) if (!PERMISSIONS.has(p)) problems.push(`permission ${p} is not available to plugins`);
  const network = (m.permissions ?? []).includes('network');
  if (network !== (m.hosts ?? []).length > 0) problems.push('network needs hosts, and hosts need network');
  if (!FILE.test(m.entry) || !m.entry.endsWith('.js')) problems.push(`entry ${m.entry} must be a .js file in the plugin`);
  for (const s of m.styles ?? []) if (!FILE.test(s) || !s.endsWith('.css')) problems.push(`style ${s} must be a .css file`);
  if ((m.styles ?? []).length > 0 && !(m.permissions ?? []).includes('ui')) problems.push('styles need the ui permission');
  return problems;
}

/** Files that go into the archive: everything but tests and dotfiles. */
function packedFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.') && !/\.test\.[jt]s$/.test(f))
    .flatMap((f) => {
      const rel = prefix ? `${prefix}/${f}` : f;
      return statSync(join(dir, f)).isDirectory() ? packedFiles(join(dir, f), rel) : [rel];
    })
    .sort();
}

function tarGz(dir: string, files: string[], out: string) {
  // Reproducible: sorted names, fixed owner and time, no gzip timestamp.
  const res = Bun.spawnSync(
    ['tar', '--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0', '-czf', out, '-C', dir, ...files],
    { env: { ...process.env, GZIP: '-n' } }
  );
  if (res.exitCode !== 0) throw new Error(`tar failed for ${dir}: ${res.stderr.toString()}`);
}

if (import.meta.main) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const entries = [];
  let failed = false;
  for (const dirName of readdirSync(pluginsDir).sort()) {
    const dir = join(pluginsDir, dirName);
    if (!existsSync(join(dir, 'manifest.json'))) continue;
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
    const problems = checkManifest(m, dirName);
    if (problems.length) {
      failed = true;
      console.error(`${dirName}:\n  ${problems.join('\n  ')}`);
      continue;
    }
    const archive = `${m.id}-${m.version}.tar.gz`;
    tarGz(dir, packedFiles(dir), join(dist, archive));
    const sha256 = createHash('sha256').update(readFileSync(join(dist, archive))).digest('hex');
    entries.push({
      id: m.id,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      description: m.description,
      author: m.author,
      permissions: m.permissions,
      url: `${baseUrl}/${archive}`,
      sha256
    });
    console.log(`${archive}  ${sha256}`);
  }
  if (failed) process.exit(1);
  const index = { format: 1, name: process.env.REGISTRY_NAME ?? 'Oscilla plugins', plugins: entries };
  writeFileSync(join(dist, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`dist/index.json: ${entries.length} plugins`);
}
