import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

export const pluginRoot = path.resolve(import.meta.dirname, '..');
export const cli = path.join(pluginRoot, 'scripts', 'spec-cycle.mjs');
export const fixtures = path.join(pluginRoot, 'fixtures', 'cases');

export function run(args, cwd = pluginRoot) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

const temporaryDirectories = [];
export function temporaryDirectory(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `spec-cycle-${name}-`));
  temporaryDirectories.push(directory);
  return directory;
}

export function registerCleanup() {
  test.after(() => {
    for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
  });
}

export function temporaryFixture(name) {
  const destination = temporaryDirectory(name);
  fs.cpSync(path.join(fixtures, name), destination, { recursive: true });
  return destination;
}

export function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function writeYaml(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(value));
}

export function editYaml(file, edit) {
  const value = readYaml(file);
  edit(value);
  writeYaml(file, value);
}

// Re-sign a critic report after a deliberate manifest edit so that only the rule under test fails.
export function refreshFingerprint(project, manifest = 'run/author-manifest.yaml', report = 'run/critic-pass-1.yaml') {
  const fingerprint = run(['fingerprint', '--manifest', manifest], project);
  assert.equal(fingerprint.status, 0, fingerprint.stderr);
  editYaml(path.join(project, report), (value) => {
    value.reviewed_fingerprint = fingerprint.stdout.trim();
  });
}

export function workItemProject(items, { decisions = {}, extraBaseline = {} } = {}) {
  const project = temporaryDirectory('project');
  fs.mkdirSync(path.join(project, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(project, 'docs', 'PRD.md'), '# PRD\n\n## F05\nRecord every change.\n');
  fs.writeFileSync(path.join(project, 'docs', 'TECH_STACK.md'), '# Tech\n');
  for (const [name, body] of Object.entries(extraBaseline)) fs.writeFileSync(path.join(project, 'docs', name), body);
  for (const [name, body] of Object.entries(decisions)) fs.writeFileSync(path.join(project, 'docs', 'decisions', name), body);
  writeYaml(path.join(project, 'docs', 'work-items.yaml'), { schema_version: '1.0', items });
  const init = run([
    'init', '--baseline', 'docs/PRD.md,docs/TECH_STACK.md', '--decision-records', 'docs/decisions', '--work-items', 'docs/work-items.yaml',
  ], project);
  assert.equal(init.status, 0, init.stderr);
  return project;
}

export const defaultItems = [
  { id: 'W01', title: 'Record revisions', status: 'pending', priority: 'high', source_refs: ['docs/PRD.md#F05'], acceptance_refs: ['A04'] },
  { id: 'W02', title: 'Already started', status: 'in-progress', source_refs: ['docs/PRD.md#F05'] },
  { id: 'W03', title: 'Missing references', status: 'pending' },
  { id: 'W04', title: 'Foreign reference', status: 'pending', source_refs: ['docs/OTHER.md#x'] },
];

// Writes a READY-looking run whose source block comes from the real CLI so fingerprints match the project.
export function writeRun(project, runId, { schemaVersion = '1.1', taskId = 'W01', decisionVectors = true } = {}) {
  const runDir = path.join(project, '.spec-cycle', 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const normalized = path.join(runDir, 'normalized-tasks.yaml');
  const normalize = run(['normalize', '--out', normalized, '--task', taskId], project);
  assert.equal(normalize.status, 0, normalize.stderr);
  const handoff = {
    schema_version: schemaVersion,
    run_id: runId,
    source: readYaml(normalized).source,
    source_tasks: [{ task_id: taskId }],
    test_obligations: [],
  };
  if (decisionVectors) handoff.decision_vectors = [];
  writeYaml(path.join(runDir, 'tdd-handoff.yaml'), handoff);
  return { runDir, handoffFile: path.join(runDir, 'tdd-handoff.yaml') };
}

export function handoffProject(options, items = defaultItems) {
  const project = workItemProject(items.map((item) => ({ ...item })));
  return { project, ...writeRun(project, 't-w01-aaaa', options) };
}

// --- fixtures ---------------------------------------------------------------
