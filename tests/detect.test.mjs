import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { detect } from '../scripts/lib/detect.mjs';
import { registerCleanup, run, temporaryDirectory } from './helpers.mjs';

registerCleanup();

function touch(root, file, content = '') {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const absent = () => ({ status: 127, stdout: '' });
// An empty config dir, so no test reads the real plugin cache of the machine running it.
const noCache = temporaryDirectory('detect-no-cache');

test('detect suggests taskmaster intake when the CLI and tasks.json exist', () => {
  const projectRoot = temporaryDirectory('detect-tm');
  touch(projectRoot, '.taskmaster/tasks/tasks.json', '{}');
  const exec = (command, args) => (command === 'which' && args[0] === 'task-master'
    ? { status: 0, stdout: '/usr/bin/task-master' }
    : absent());
  const result = detect({ projectRoot, exec, configDir: noCache });
  assert.equal(result.task_master.cli, true);
  assert.equal(result.task_master.tasks_file, '.taskmaster/tasks/tasks.json');
  assert.equal(result.suggested.intake, 'taskmaster');
});

test('detect suggests native intake when tasks.json exists but the CLI does not', () => {
  const projectRoot = temporaryDirectory('detect-tm-nocli');
  touch(projectRoot, '.taskmaster/tasks/tasks.json', '{}');
  const result = detect({ projectRoot, exec: absent, configDir: noCache });
  assert.equal(result.task_master.tasks_file, '.taskmaster/tasks/tasks.json');
  assert.equal(result.suggested.intake, 'native');
});

test('detect suggests inline execution when superpowers is not installed', () => {
  const projectRoot = temporaryDirectory('detect-sp');
  const exec = (command) => (command === 'claude'
    ? { status: 0, stdout: 'code-review@anthropic-plugin-directory' }
    : absent());
  const result = detect({ projectRoot, exec, configDir: noCache });
  assert.equal(result.superpowers, false);
  assert.equal(result.suggested.execution, 'inline');
  const installed = detect({
    projectRoot,
    exec: () => ({ status: 0, stdout: 'superpowers@claude-plugins-official' }),
    configDir: noCache,
  });
  assert.equal(installed.superpowers, true);
  assert.equal(installed.suggested.execution, 'superpowers');
});

test('detect lists only baseline documents that exist, in spec order', () => {
  const projectRoot = temporaryDirectory('detect-baseline');
  for (const file of [
    'docs/TECH_STACK.md', 'docs/PRD.md', 'docs/REQUIREMENT_B.md', 'docs/REQUIREMENT_A.md',
    '.taskmaster/docs/prd.md', 'docs/superpowers/specs/z.md', 'docs/superpowers/specs/a.md',
  ]) touch(projectRoot, file);
  assert.deepEqual(detect({ projectRoot, exec: absent, configDir: noCache }).baseline_candidates, [
    'docs/PRD.md', 'docs/TECH_STACK.md', 'docs/REQUIREMENT_A.md', 'docs/REQUIREMENT_B.md',
    '.taskmaster/docs/prd.md', 'docs/superpowers/specs/a.md', 'docs/superpowers/specs/z.md',
  ]);
  const empty = temporaryDirectory('detect-empty');
  const none = detect({ projectRoot: empty, exec: absent });
  assert.deepEqual(none.baseline_candidates, []);
  assert.equal(none.decision_records_candidate, null);
  assert.deepEqual(none.test_glob_candidates, []);
});

test('detect reports decision records and test globs that match files', () => {
  const projectRoot = temporaryDirectory('detect-layout');
  touch(projectRoot, 'docs/decisions/0001.md');
  touch(projectRoot, 'AppTests/FooTests.swift');
  touch(projectRoot, 'src/a/b.spec.ts');
  const result = detect({ projectRoot, exec: absent, configDir: noCache });
  assert.equal(result.decision_records_candidate, 'docs/decisions');
  assert.deepEqual(result.test_glob_candidates, ['*Tests/**/*.swift', 'src/**/*.spec.ts']);
});

test('detect reports an existing .spec-gate config for adoption', () => {
  const projectRoot = temporaryDirectory('detect-adopt');
  touch(projectRoot, '.spec-gate/config.yaml', 'x: 1\n');
  const result = detect({ projectRoot, exec: absent, configDir: noCache });
  assert.deepEqual(result.existing_config, { spec_gate: '.spec-gate/config.yaml', spec_cycle: null });
  touch(projectRoot, '.spec-cycle/config.yaml', 'x: 1\n');
  assert.equal(detect({ projectRoot, exec: absent, configDir: noCache }).existing_config.spec_cycle, '.spec-cycle/config.yaml');
});

test('detect treats a failing exec as absent or unknown instead of throwing', () => {
  const projectRoot = temporaryDirectory('detect-fail');
  const configDir = temporaryDirectory('detect-fail-config');
  const result = detect({ projectRoot, exec: absent, configDir });
  assert.equal(result.task_master.cli, false);
  assert.equal(result.superpowers, null);
  const thrown = detect({ projectRoot, exec: () => ({ status: 0, stdout: undefined }), configDir });
  assert.equal(thrown.superpowers, false);
});

test('detect CLI prints YAML with a suggested block', () => {
  const dir = temporaryDirectory('detect-cli');
  const result = run(['detect', '--project', dir]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = YAML.parse(result.stdout);
  assert.equal(typeof parsed, 'object');
  assert.ok('suggested' in parsed);
});

test('detect tells an unavailable plugin list apart from a missing superpowers', () => {
  const projectRoot = temporaryDirectory('detect-sp-unknown');
  const configDir = temporaryDirectory('detect-sp-config');
  const failing = (command) => (command === 'claude' ? { status: 1, stdout: '' } : absent());
  const unknown = detect({ projectRoot, exec: failing, configDir });
  assert.equal(unknown.superpowers, null);
  assert.equal(unknown.superpowers_source, 'unavailable');
  assert.equal(unknown.suggested.execution, 'inline');
  touch(configDir, 'plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/writing-plans/SKILL.md', '# skill');
  const cached = detect({ projectRoot, exec: failing, configDir });
  assert.equal(cached.superpowers, true);
  assert.equal(cached.superpowers_source, 'plugin-cache');
  assert.equal(cached.suggested.execution, 'superpowers');
  const listed = detect({ projectRoot, exec: () => ({ status: 0, stdout: 'code-review@x' }), configDir });
  assert.equal(listed.superpowers, false);
  assert.equal(listed.superpowers_source, 'plugin-list');
});
