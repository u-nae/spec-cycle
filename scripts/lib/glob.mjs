import fs from 'node:fs';
import path from 'node:path';
import { portablePath } from './util.mjs';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

// Anchored glob: `**` spans zero or more path segments, `*` and `?` never cross `/`.
export function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i += 1;
      if (pattern[i + 1] === '/') {
        i += 1;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

// Walks the tree once (pruning node_modules and .git) and returns sorted repo-relative matches.
export function matchGlobs(root, patterns) {
  const expressions = patterns.map(globToRegExp);
  const matches = new Set();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(full);
      } else {
        const relative = portablePath(full, root);
        if (expressions.some((expression) => expression.test(relative))) matches.add(relative);
      }
    }
  };
  if (expressions.length > 0 && fs.existsSync(root)) visit(root);
  return [...matches].sort();
}
