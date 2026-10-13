import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { globToRegExp, matchGlobs } from '../scripts/lib/glob.mjs';
import { registerCleanup, temporaryDirectory } from './helpers.mjs';

registerCleanup();

function touch(root, file) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '');
}

test('glob ** crosses directory boundaries', () => {
  const root = temporaryDirectory('glob-deep');
  for (const file of ['tests/a.mjs', 'tests/x/y.mjs', 'other/b.mjs']) touch(root, file);
  assert.deepEqual(matchGlobs(root, ['tests/**']), ['tests/a.mjs', 'tests/x/y.mjs']);
  assert.ok(globToRegExp('src/**/*.ts').test('src/a.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
});

test('glob * does not cross a path separator', () => {
  assert.ok(globToRegExp('tests/*.mjs').test('tests/a.mjs'));
  assert.ok(!globToRegExp('tests/*.mjs').test('tests/x/a.mjs'));
  assert.ok(!globToRegExp('a?c').test('a/c'));
  assert.ok(!globToRegExp('a.c').test('abc'));
});

test('glob results are sorted, deduplicated and skip node_modules and .git', () => {
  const root = temporaryDirectory('glob-sort');
  for (const file of ['b/z.swift', 'a/y.swift', 'node_modules/p/q.swift', '.git/r.swift']) touch(root, file);
  assert.deepEqual(matchGlobs(root, ['**/*.swift', 'a/*.swift']), ['a/y.swift', 'b/z.swift']);
  assert.deepEqual(matchGlobs(root, []), []);
});
