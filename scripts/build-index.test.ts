import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { checkManifest } from './build-index';

describe('plugins in this registry', () => {
  const dir = join(import.meta.dir, '..', 'plugins');
  for (const name of readdirSync(dir)) {
    test(`${name} has a valid manifest`, () => {
      const m = JSON.parse(readFileSync(join(dir, name, 'manifest.json'), 'utf8'));
      expect(checkManifest(m, name)).toEqual([]);
    });
  }

  test('internal permissions and missing hosts are refused', () => {
    const base = { id: 'com.example.x', name: 'x', version: '1.0.0', apiVersion: 1, description: 'd', author: 'a', entry: 'main.js', permissions: [] as string[] };
    expect(checkManifest({ ...base, permissions: ['internal:config'] }, 'com.example.x')).not.toEqual([]);
    expect(checkManifest({ ...base, permissions: ['network'] }, 'com.example.x')).not.toEqual([]);
    expect(checkManifest({ ...base, entry: '../x.js' }, 'com.example.x')).not.toEqual([]);
    expect(checkManifest(base, 'other-folder')).not.toEqual([]);
  });
});
