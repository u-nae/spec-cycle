import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  defaultItems, editYaml, handoffProject, readYaml, registerCleanup, run, temporaryDirectory, workItemProject, writeRun, writeYaml,
} from './helpers.mjs';

registerCleanup();

function resolution(project, task = 'W01') {
  const result = run(['resolve-handoff', '--task', task], project);
  const file = path.join(temporaryDirectory('resolution'), 'out.yaml');
  fs.writeFileSync(file, result.stdout);
  return { result, value: readYaml(file) };
}

function setTime(file, seconds) {
  fs.utimesSync(file, seconds, seconds);
}

test('resolve-handoff reports no handoff for a work item that never passed the gate', () => {
  const { project } = handoffProject();
  const { result, value } = resolution(project, 'W02');
  assert.equal(result.status, 1);
  assert.deepEqual(value, {
    task_id: 'W02', run_id: null, run_dir: null, handoff: null, brief: null, handoff_schema: null,
    usable: false, errors: ['no READY handoff for W02; run /spec-cycle:run W02 first'], warnings: [],
    work_item_status: 'in-progress',
  });
  assert.match(result.stderr, /- no READY handoff for W02/);
});

test('resolve-handoff reports no handoff when the run root does not exist', () => {
  const project = workItemProject(defaultItems.map((item) => ({ ...item })));
  const { result, value } = resolution(project);
  assert.equal(result.status, 1);
  assert.equal(value.usable, false);
  assert.deepEqual(value.errors, ['no READY handoff for W01; run /spec-cycle:run W01 first']);
});

test('resolve-handoff selects the most recent run that has a handoff for the task', () => {
  const { project, handoffFile } = handoffProject();
  // The older run sorts last by name, so only the mtime can make t-w01-aaaa win.
  const older = writeRun(project, 't-w01-zzzz');
  setTime(older.handoffFile, 1_000_000);
  setTime(handoffFile, 2_000_000);
  const { result, value } = resolution(project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(value.run_id, 't-w01-aaaa');
  assert.equal(value.run_dir, '.spec-cycle/runs/t-w01-aaaa');
  assert.equal(value.handoff, '.spec-cycle/runs/t-w01-aaaa/tdd-handoff.yaml');
  assert.equal(value.brief, '.spec-cycle/runs/t-w01-aaaa/spec-brief.md');
  assert.equal(value.handoff_schema, '1.1');
  assert.equal(value.usable, true);
  assert.deepEqual(value.errors, []);
  assert.deepEqual(value.warnings, []);
  assert.equal(value.work_item_status, 'pending');

  setTime(older.handoffFile, 3_000_000);
  assert.equal(resolution(project).value.run_id, 't-w01-zzzz');
});

test('resolve-handoff is unusable when a baseline document changed', () => {
  const { project } = handoffProject();
  fs.appendFileSync(path.join(project, 'docs', 'PRD.md'), '\nMore.\n');
  const { result, value } = resolution(project);
  assert.equal(result.status, 1);
  assert.equal(value.usable, false);
  assert.deepEqual(value.errors, ['baseline docs/PRD.md changed since the handoff; rerun the gate']);
  assert.equal(value.run_id, 't-w01-aaaa');
});

test('resolve-handoff is unusable when a definitional field of the work item changed', () => {
  const { project } = handoffProject();
  editYaml(path.join(project, 'docs', 'work-items.yaml'), (data) => {
    const item = data.items.find((entry) => entry.id === 'W01');
    item.details = 'Now with different details';
    item.acceptance_refs = ['A04', 'A05'];
  });
  const { result, value } = resolution(project);
  assert.equal(result.status, 1);
  assert.deepEqual(value.errors, ['work item W01 definition changed (fields: details, acceptance_refs); rerun the gate']);
});

test('resolve-handoff ignores a status change of the work item', () => {
  const { project } = handoffProject();
  const status = run(['set-status', '--task', 'W01', '--status', 'in-progress'], project);
  assert.equal(status.status, 0, status.stderr);
  const { result, value } = resolution(project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(value.usable, true);
  assert.deepEqual(value.errors, []);
  assert.equal(value.work_item_status, 'in-progress');
});

test('resolve-handoff warns but stays usable when only decision records changed', () => {
  const { project, handoffFile } = handoffProject();
  setTime(handoffFile, 1_000_000);
  fs.writeFileSync(path.join(project, 'docs', 'decisions', '0034-x.md'), '# Decision\n');
  const { result, value } = resolution(project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(value.usable, true);
  assert.deepEqual(value.errors, []);
  assert.deepEqual(value.warnings, ['decision records changed since the handoff: docs/decisions/0034-x.md']);
});

test('resolve-handoff warns when the work item is already done', () => {
  const { project } = handoffProject();
  for (const status of ['in-progress', 'done']) {
    const set = run(['set-status', '--task', 'W01', '--status', status], project);
    assert.equal(set.status, 0, set.stderr);
  }
  const { result, value } = resolution(project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(value.usable, true);
  assert.deepEqual(value.warnings, ['work item W01 is already done']);
});

test('resolve-handoff reads a 1.0 handoff without decision_vectors', () => {
  const { project } = handoffProject({ schemaVersion: '1.0', decisionVectors: false });
  const { result, value } = resolution(project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(value.handoff_schema, '1.0');
  assert.equal(value.usable, true);
});

test('resolve-handoff is unusable when the work item no longer exists', () => {
  const { project } = handoffProject();
  editYaml(path.join(project, 'docs', 'work-items.yaml'), (data) => {
    data.items = data.items.filter((entry) => entry.id !== 'W01');
  });
  const { value } = resolution(project);
  assert.equal(value.usable, false);
  assert.equal(value.work_item_status, null);
  assert.ok(value.errors.includes('work item W01 not found in docs/work-items.yaml'));
});

test('resolve-handoff is unusable when a baseline document was added since the handoff', () => {
  const { project } = handoffProject();
  fs.writeFileSync(path.join(project, 'docs', 'ARCH.md'), '# Architecture\n');
  editYaml(path.join(project, '.spec-cycle', 'config.yaml'), (config) => {
    config.baseline.push('docs/ARCH.md');
  });
  const { result, value } = resolution(project);
  assert.equal(result.status, 1);
  assert.equal(value.usable, false);
  assert.deepEqual(value.errors, ['baseline docs/ARCH.md was added since the handoff; rerun the gate']);
});
