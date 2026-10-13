import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const args = { _: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return { command, args };
}

function required(args, key) {
  if (!args[key] || args[key] === true) {
    throw new Error(`Missing required option --${key}`);
  }
  return args[key];
}

function optional(args, key) {
  return args[key] && args[key] !== true ? String(args[key]) : null;
}

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

function writeYaml(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(value, { lineWidth: 0 }));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function portablePath(file, projectRoot = process.cwd()) {
  const relative = path.relative(projectRoot, path.resolve(projectRoot, file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return '.';
    throw new Error(`Path is outside project root: ${file}`);
  }
  return relative.split(path.sep).join('/');
}

function assertPortable(value, label, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label} must be a non-empty repository-relative path`);
    return false;
  }
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    errors.push(`${label} must be repository-relative without parent traversal: ${value}`);
    return false;
  }
  return true;
}

export {
  ValidationError,
  parseArgs,
  required,
  optional,
  readYaml,
  writeYaml,
  sha256File,
  isBlank,
  asArray,
  isObject,
  portablePath,
  assertPortable,
};
