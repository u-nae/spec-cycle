import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readYaml, registerCleanup, run, workItemProject, writeYaml } from './helpers.mjs';

registerCleanup();

function project(tasksJson) {
  const dir = workItemProject([]);
  const tasks = path.join(dir, '.taskmaster', 'tasks', 'tasks.json');
  fs.mkdirSync(path.dirname(tasks), { recursive: true });
  fs.writeFileSync(tasks, JSON.stringify(tasksJson));
  return { dir, tasks, items: path.join(dir, 'docs', 'work-items.yaml') };
}

function importTm(dir, extra = []) {
  const result = run(['import-taskmaster', ...extra], dir);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const sample = {
  master: {
    tasks: [{
      id: 6, title: 'Undo', description: 'd', details: 'det', testStrategy: 'unit', priority: 'high', status: 'pending',
      dependencies: [4, '5.2'], subtasks: [{ id: 1, title: 'Store', status: 'pending' }],
    }],
  },
};

test('import creates T-prefixed items from a tagged tasks.json with dotted subtask ids', () => {
  const { dir, items } = project(sample);
  const result = importTm(dir);
  const [item] = readYaml(items).items;
  assert.equal(item.id, 'T6');
  assert.equal(item.subtasks[0].id, '1');
  assert.equal(item.subtasks[0].external_ref, 'taskmaster:master:6.1');
  assert.deepEqual(item.dependencies, ['T4', 'T5.2']);
  assert.equal(item.external_ref, 'taskmaster:master:6');
  assert.equal(item.test_strategy, 'unit');
  assert.deepEqual(readYaml(items).items[0].source_refs, []);
  const out = readYaml(path.join(dir, 'docs', 'work-items.yaml'));
  assert.equal(out.schema_version, '1.0');
  assert.match(result.stdout, /T6\.1/);
});

test('import accepts legacy {tasks:[]} and bare array formats', () => {
  for (const shape of [{ tasks: [{ id: 1, title: 'A' }] }, [{ id: 1, title: 'A' }]]) {
    const { dir, items } = project(shape);
    importTm(dir);
    const [item] = readYaml(items).items;
    assert.equal(item.id, 'T1');
    assert.equal(item.external_ref, 'taskmaster:master:1');
  }
});

test('import maps review to in-progress and cancelled to deferred on first import', () => {
  const { dir, items } = project({ tasks: [
    { id: 1, title: 'A', status: 'review' },
    { id: 2, title: 'B', status: 'cancelled' },
    { id: 3, title: 'C', status: 'foo', priority: 'p0' },
  ] });
  const result = importTm(dir);
  const out = readYaml(items).items;
  assert.deepEqual(out.map((item) => item.status), ['in-progress', 'deferred', 'pending']);
  assert.equal(out[2].priority, 'medium');
  assert.match(result.stdout, /task 3: unknown status foo mapped to pending/);
  assert.match(result.stdout, /task 3: unknown priority p0 mapped to medium/);
});

test('import appends acceptanceCriteria text to details and leaves acceptance_refs empty', () => {
  const { dir, items } = project({ tasks: [
    { id: 1, title: 'A', details: 'base', acceptanceCriteria: ['one', 'two'] },
    { id: 2, title: 'B', acceptanceCriteria: ['x'] },
  ] });
  importTm(dir);
  const out = readYaml(items).items;
  assert.equal(out[0].details, 'base\n\nAcceptance criteria (Task Master):\n- one\n- two');
  assert.equal(out[1].details, 'Acceptance criteria (Task Master):\n- x');
  assert.deepEqual(out[0].acceptance_refs, []);
});

test('re-import keeps locally enriched source_refs, acceptance_refs and status', () => {
  const { dir, tasks, items } = project({ tasks: [{ id: 6, title: 'Undo', status: 'done' }] });
  importTm(dir);
  const edited = readYaml(items);
  edited.items[0].source_refs = ['docs/PRD.md#F05'];
  edited.items[0].acceptance_refs = ['A04'];
  edited.items[0].status = 'pending';
  edited.items[0].local_note = 'keep';
  writeYaml(items, edited);
  fs.writeFileSync(tasks, JSON.stringify({ tasks: [{ id: 6, title: 'Undo v2', status: 'done' }] }));
  const result = importTm(dir);
  const [item] = readYaml(items).items;
  assert.equal(item.title, 'Undo v2');
  assert.deepEqual(item.source_refs, ['docs/PRD.md#F05']);
  assert.deepEqual(item.acceptance_refs, ['A04']);
  assert.equal(item.status, 'pending');
  assert.equal(item.local_note, 'keep');
  const parsed = readYaml(items);
  assert.equal(parsed.items.length, 1);
  assert.match(result.stdout, /T6: Task Master status done differs from local status pending \(local kept\)/);
  assert.equal((result.stdout.match(/differs from local status/g) ?? []).length, 1);
});

test('re-import marks items missing from tasks.json as deferred with a reason', () => {
  const { dir, tasks, items } = project({ tasks: [{ id: 1, title: 'A' }, { id: 2, title: 'B', details: 'why' }] });
  importTm(dir);
  const native = readYaml(items);
  native.items.push({ id: 'W9', title: 'native', status: 'pending' });
  writeYaml(items, native);
  fs.writeFileSync(tasks, JSON.stringify({ tasks: [{ id: 1, title: 'A' }] }));
  const result = importTm(dir);
  const second = importTm(dir);
  const out = readYaml(items).items;
  assert.equal(out[1].status, 'deferred');
  assert.equal((out[1].details.match(/Deferred: removed/g) ?? []).length, 1);
  assert.match(out[1].details, /\n\nDeferred: removed from Task Master tag master on import$/);
  assert.equal(out[2].status, 'pending');
  assert.match(result.stdout, /deferred:\n\s+- T2/);
  assert.doesNotMatch(second.stdout, /deferred:\n\s+- T2/);
});

test('import preserves comments in work-items.yaml', () => {
  const { dir, items } = project({ tasks: [{ id: 1, title: 'A' }] });
  fs.writeFileSync(items, '# header comment\nschema_version: "1.0"\nitems:\n  # native item\n  - id: W1 # inline\n    title: Native\n    status: pending\n');
  importTm(dir);
  const text = fs.readFileSync(items, 'utf8');
  assert.match(text, /# header comment/);
  assert.match(text, /# native item/);
  assert.match(text, /# inline/);
  assert.equal(readYaml(items).items.length, 2);
});

test('import fails with the available tags when the requested tag is absent', () => {
  const { dir } = project({ master: { tasks: [] }, phase1: { tasks: [] } });
  const result = run(['import-taskmaster', '--tag', 'phase2'], dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tag phase2 not found; available: master, phase1/);
});

test('import coerces numeric ids and string dependencies consistently', () => {
  const { dir, items } = project({ tasks: [
    { id: '3', title: 'A', dependencies: [1, '2', '2.1'] },
    { id: 4, title: 'B', dependencies: ['3'], subtasks: [{ id: '2', title: 'S', dependencies: [1, '4.1'] }] },
  ] });
  importTm(dir);
  const out = readYaml(items).items;
  assert.equal(out[0].id, 'T3');
  assert.deepEqual(out[0].dependencies, ['T1', 'T2', 'T2.1']);
  assert.deepEqual(out[1].dependencies, ['T3']);
  assert.equal(out[1].subtasks[0].id, '2');
  assert.equal(out[1].subtasks[0].external_ref, 'taskmaster:master:4.2');
  assert.deepEqual(out[1].subtasks[0].dependencies, ['1', 'T4.1']);
});

test('subtask dependencies stay parent-relative unless dotted, and the normalizer resolves them', () => {
  const { dir, items } = project({ tasks: [
    { id: 6, title: 'Undo', subtasks: [{ id: 1, title: 'Store' }, { id: 2, title: 'Apply', dependencies: [1, '5.2'] }] },
  ] });
  importTm(dir);
  assert.deepEqual(readYaml(items).items[0].subtasks[1].dependencies, ['1', 'T5.2']);
  const normalized = run(['normalize', '--out', 'out/normalized.yaml', '--task', 'T6'], dir);
  assert.equal(normalized.status, 0, normalized.stderr);
  const tasks = readYaml(path.join(dir, 'out', 'normalized.yaml')).tasks;
  const sub = tasks.find((task) => task.task_id === 'T6.2');
  assert.deepEqual(sub.dependencies, ['T6.1', 'T5.2']);
});

// A hand-written file that a previous import enriched: folded text wrapped at the author's width, flow lists
// without padding, a comment, and a native item. Re-import must leave untouched items byte-identical.
function handWrittenImport() {
  const tasksJson = { tasks: [
    { id: 1, title: 'Base', description: 'd1', details: 'one two three four', testStrategy: 'unit', priority: 'high', status: 'done' },
    { id: 2, title: 'Snapshot', description: 'd2', details: 'five six', testStrategy: 'unit', priority: 'medium', status: 'pending', dependencies: [1] },
  ] };
  const { dir, tasks, items } = project(tasksJson);
  fs.writeFileSync(items, [
    '# work items',
    'schema_version: "1.0"',
    'items:',
    '  - id: T1',
    '    title: Base',
    '    description: d1',
    '    details: >-',
    '      one two',
    '      three four',
    '    test_strategy: unit',
    '    priority: high',
    '    dependencies: []',
    '    status: done   # finished',
    '    source_refs: [docs/PRD.md#F01]',
    '    acceptance_refs: [A18]',
    '    external_ref: taskmaster:master:1',
    '  # second',
    '  - id: T2',
    '    title: Snapshot',
    '    description: d2',
    '    details: >-',
    '      five',
    '      six',
    '    test_strategy: unit',
    '    priority: medium',
    '    dependencies: [T1]',
    '    status: pending',
    '    source_refs: []',
    '    acceptance_refs: [A01, A02]',
    '    external_ref: taskmaster:master:2',
    '  - id: W9',
    '    title: native',
    '    status: pending',
    '# tail',
    '',
  ].join('\n'));
  return { dir, tasks, items, tasksJson };
}

test('re-import of unchanged tasks leaves a hand-written work-items file byte-identical', () => {
  const { dir, items } = handWrittenImport();
  const before = fs.readFileSync(items, 'utf8');
  const result = importTm(dir);
  assert.equal(fs.readFileSync(items, 'utf8'), before);
  assert.match(result.stdout, /updated:\n\s+- T1\n\s+- T2/);
});

test('re-import with one changed task rewrites only that item and keeps the others byte-identical', () => {
  const { dir, tasks, items, tasksJson } = handWrittenImport();
  const before = fs.readFileSync(items, 'utf8');
  tasksJson.tasks[1].title = 'Snapshot v2';
  fs.writeFileSync(tasks, JSON.stringify(tasksJson));
  importTm(dir);
  const after = fs.readFileSync(items, 'utf8');
  const head = before.slice(0, before.indexOf('  - id: T2'));
  const tail = before.slice(before.indexOf('  - id: W9'));
  assert.ok(after.startsWith(head), 'T1 and everything before it must be unchanged');
  assert.ok(after.endsWith(tail), 'the native item and trailing comment must be unchanged');
  const [, t2] = readYaml(items).items;
  assert.equal(t2.title, 'Snapshot v2');
  assert.deepEqual(t2.acceptance_refs, ['A01', 'A02']);
  assert.equal(t2.details, 'five six');
  assert.equal(readYaml(items).items.length, 3);
});

test('re-import appends a new task after the existing items without touching them', () => {
  const { dir, tasks, items, tasksJson } = handWrittenImport();
  const before = fs.readFileSync(items, 'utf8');
  tasksJson.tasks.push({ id: 3, title: 'Diff', status: 'pending' });
  fs.writeFileSync(tasks, JSON.stringify(tasksJson));
  importTm(dir);
  const after = fs.readFileSync(items, 'utf8');
  const body = before.slice(0, before.indexOf('# tail'));
  assert.ok(after.startsWith(body), 'existing items must be unchanged');
  assert.ok(after.endsWith('# tail\n'));
  const parsed = readYaml(items).items;
  assert.deepEqual(parsed.map((item) => item.id), ['T1', 'T2', 'W9', 'T3']);
  assert.equal(parsed[3].external_ref, 'taskmaster:master:3');
});

test('re-import that defers a removed task rewrites only that item', () => {
  const { dir, tasks, items, tasksJson } = handWrittenImport();
  const before = fs.readFileSync(items, 'utf8');
  tasksJson.tasks.pop();
  fs.writeFileSync(tasks, JSON.stringify(tasksJson));
  importTm(dir);
  const after = fs.readFileSync(items, 'utf8');
  assert.ok(after.startsWith(before.slice(0, before.indexOf('  - id: T2'))));
  assert.ok(after.endsWith(before.slice(before.indexOf('  - id: W9'))));
  assert.equal(readYaml(items).items[1].status, 'deferred');
});

test('re-import adding a subtask to an existing task rewrites only that task', () => {
  const { dir, tasks, items, tasksJson } = handWrittenImport();
  const before = fs.readFileSync(items, 'utf8');
  tasksJson.tasks[0].subtasks = [{ id: 1, title: 'Sub', status: 'pending' }];
  fs.writeFileSync(tasks, JSON.stringify(tasksJson));
  importTm(dir);
  const after = fs.readFileSync(items, 'utf8');
  assert.ok(after.endsWith(before.slice(before.indexOf('  # second'))), 'T2 and later must be unchanged');
  const [t1] = readYaml(items).items;
  assert.equal(t1.subtasks[0].external_ref, 'taskmaster:master:1.1');
  assert.deepEqual(t1.source_refs, ['docs/PRD.md#F01']);
});
