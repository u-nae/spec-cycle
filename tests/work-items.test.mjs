import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readYaml, registerCleanup, run, workItemProject } from './helpers.mjs';
import { definitionalFields } from '../scripts/lib/work-items.mjs';

registerCleanup();

const items = () => [
  { id: 'W05', title: 'Done already', status: 'done' },
  { id: 'W06', title: 'Record revisions', status: 'pending', subtasks: [{ id: '1', title: 'Sub one', status: 'pending' }, { id: '2', title: 'Sub two', status: 'pending' }] },
  { id: 'W07', title: 'Started', status: 'in-progress' },
];

function commentedProject() {
  const project = workItemProject(items());
  const file = path.join(project, 'docs', 'work-items.yaml');
  const text = fs.readFileSync(file, 'utf8')
    .replace('items:', '# keep me\nitems:')
    .replace('title: Started', 'title: Started # inline note');
  fs.writeFileSync(file, text);
  return { project, file };
}

test('set-status moves a pending item to in-progress and keeps file comments', () => {
  const { project, file } = commentedProject();
  const before = fs.readFileSync(file, 'utf8');
  const result = run(['set-status', '--task', 'W06', '--status', 'in-progress'], project);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /task_id: W06/);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /# keep me/);
  assert.match(after, /# inline note/);
  assert.equal(readYaml(file).items[1].status, 'in-progress');
  const changed = before.split('\n').map((line, index) => [line, after.split('\n')[index]]).filter(([a, b]) => a !== b);
  assert.equal(changed.length, 1);
  assert.equal(before.split('\n').length, after.split('\n').length);
});

test('set-status allows pending to done for items implemented without implement', () => {
  const project = workItemProject(items());
  const result = run(['set-status', '--task', 'W06', '--status', 'done'], project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readYaml(path.join(project, 'docs', 'work-items.yaml')).items[1].status, 'done');
});

test('set-status rejects done to pending', () => {
  const project = workItemProject(items());
  const result = run(['set-status', '--task', 'W05', '--status', 'pending'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /W05: status transition done -> pending is not allowed/);
  assert.equal(readYaml(path.join(project, 'docs', 'work-items.yaml')).items[0].status, 'done');
});

test('set-status rejects an unknown status', () => {
  const project = workItemProject(items());
  const result = run(['set-status', '--task', 'W06', '--status', 'bogus'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /W06: unknown status bogus/);
});

test('set-status rejects an unknown work item', () => {
  const project = workItemProject(items());
  const result = run(['set-status', '--task', 'W99', '--status', 'done'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /work item W99 not found/);
});

test('set-status on the same status is a no-op', () => {
  const { project, file } = commentedProject();
  const before = fs.readFileSync(file, 'utf8');
  const result = run(['set-status', '--task', 'W07', '--status', 'in-progress'], project);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /from: in-progress/);
  assert.match(result.stdout, /to: in-progress/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('set-status finds a dotted subtask id', () => {
  const project = workItemProject(items());
  const file = path.join(project, 'docs', 'work-items.yaml');
  const before = readYaml(file);
  const result = run(['set-status', '--task', 'W06.1', '--status', 'done'], project);
  assert.equal(result.status, 0, result.stderr);
  const after = readYaml(file);
  assert.equal(after.items[1].subtasks[0].status, 'done');
  before.items[1].subtasks[0].status = 'done';
  assert.deepEqual(after, before);
});

test('definitionalFields defaults missing fields', () => {
  assert.deepEqual(definitionalFields({ id: 'W01', status: 'pending' }), {
    title: null, description: null, details: null, test_strategy: null,
    dependencies: [], source_refs: [], acceptance_refs: [],
  });
});

test('definitionalFields normalizes list order and ignores non-definitional keys', () => {
  const input = { id: 'W01', status: 'done', title: 'T', dependencies: ['W03', 'W02'], source_refs: ['b', 'a'], acceptance_refs: ['A2', 'A1'] };
  const fields = definitionalFields(input);
  assert.deepEqual(fields.dependencies, ['W02', 'W03']);
  assert.deepEqual(fields.source_refs, ['a', 'b']);
  assert.deepEqual(fields.acceptance_refs, ['A1', 'A2']);
  assert.equal('status' in fields, false);
  assert.deepEqual(input.dependencies, ['W03', 'W02']);
});

test('set-status treats an item without a status key as pending', () => {
  const project = workItemProject([{ id: 'W08', title: 'No status yet' }]);
  const file = path.join(project, 'docs', 'work-items.yaml');
  const result = run(['set-status', '--task', 'W08', '--status', 'in-progress'], project);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /from: pending/);
  assert.equal(readYaml(file).items[0].status, 'in-progress');
});
