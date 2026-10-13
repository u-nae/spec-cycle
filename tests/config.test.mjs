import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  run, temporaryDirectory, readYaml, writeYaml, editYaml, workItemProject, defaultItems, registerCleanup,
} from './helpers.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';

registerCleanup();

const configPath = (project) => path.join(project, '.spec-cycle', 'config.yaml');

test('a 1.0 config loads with native intake, inline execution and empty test globs', () => {
  const project = workItemProject(defaultItems);
  writeYaml(configPath(project), {
    schema_version: '1.0',
    baseline: ['docs/PRD.md', 'docs/TECH_STACK.md'],
    decision_records: 'docs/decisions',
    work_items: 'docs/work-items.yaml',
    run_root: '.spec-cycle/runs',
  });
  const result = run(['resolve-inputs'], project);
  assert.equal(result.status, 0, result.stderr);
  const config = loadConfig(project);
  assert.equal(config.schema_version, '1.0');
  assert.equal(config.intake.adapter, 'native');
  assert.equal(config.intake.taskmaster.tasks, '.taskmaster/tasks/tasks.json');
  assert.equal(config.intake.taskmaster.tag, null);
  assert.equal(config.execution.adapter, 'inline');
  assert.equal(config.execution.command, null);
  assert.equal(config.execution.plan_dir, 'docs/superpowers/plans');
  assert.deepEqual(config.verification.test_globs, []);
  assert.equal(config.verification.id_pattern, null);
  assert.equal(config.verification.test_command, null);
});

test('a 1.1 config rejects an unknown intake adapter', () => {
  const project = workItemProject(defaultItems);
  editYaml(configPath(project), (config) => {
    config.intake = { adapter: 'jira' };
  });
  const result = run(['resolve-inputs'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /intake\.adapter must be one of native, taskmaster/);
});

test('a 1.1 config with execution command requires execution.command', () => {
  const project = workItemProject(defaultItems);
  editYaml(configPath(project), (config) => {
    config.execution = { adapter: 'command', command: null };
  });
  const result = run(['resolve-inputs'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /execution\.command is required when execution\.adapter is command/);
});

test('init writes a 1.1 config with the requested adapters', () => {
  const project = temporaryDirectory('init');
  fs.mkdirSync(path.join(project, 'docs'));
  fs.writeFileSync(path.join(project, 'docs', 'PRD.md'), '# PRD\n');
  const result = run([
    'init', '--baseline', 'docs/PRD.md', '--intake', 'taskmaster', '--execution', 'superpowers',
    '--test-globs', 'tests/**/*.mjs,src/**/*.test.ts',
  ], project);
  assert.equal(result.status, 0, result.stderr);
  const config = readYaml(configPath(project));
  assert.equal(config.schema_version, '1.1');
  assert.equal(config.intake.adapter, 'taskmaster');
  assert.equal(config.execution.adapter, 'superpowers');
  assert.equal(config.verification.test_globs.length, 2);
  assert.equal(loadConfig(project).execution.adapter, 'superpowers');
});

test('init --adopt copies baseline, records, work items and run root from an existing 1.0 config', () => {
  const project = temporaryDirectory('adopt');
  fs.mkdirSync(path.join(project, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(project, 'docs', 'PRD.md'), '# PRD\n');
  writeYaml(path.join(project, 'docs', 'work-items.yaml'), { schema_version: '1.0', items: [] });
  const adopted = path.join(project, '.spec-gate', 'config.yaml');
  writeYaml(adopted, {
    schema_version: '1.0',
    baseline: ['docs/PRD.md'],
    decision_records: 'docs/decisions',
    work_items: 'docs/work-items.yaml',
    run_root: '.spec-gate/runs',
  });
  const before = fs.readFileSync(adopted, 'utf8');
  const result = run(['init', '--adopt', '.spec-gate/config.yaml'], project);
  assert.equal(result.status, 0, result.stderr);
  const config = readYaml(configPath(project));
  assert.equal(config.schema_version, '1.1');
  assert.equal(config.run_root, '.spec-gate/runs');
  assert.deepEqual(config.baseline, ['docs/PRD.md']);
  assert.equal(config.decision_records, 'docs/decisions');
  assert.equal(config.work_items, 'docs/work-items.yaml');
  assert.equal(fs.readFileSync(adopted, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(project, '.spec-gate')), ['config.yaml']);
});

test('init refuses to overwrite an existing 1.1 config even with --adopt', () => {
  const project = workItemProject(defaultItems);
  const before = fs.readFileSync(configPath(project), 'utf8');
  const result = run(['init', '--adopt', '.spec-cycle/config.yaml'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to overwrite existing config/);
  assert.equal(fs.readFileSync(configPath(project), 'utf8'), before);
});
