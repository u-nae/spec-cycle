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

// A hand-written work-item file: folded scalars wrapped at the author's width, flow lists without padding,
// a quoted scalar and a comment. set-status must change exactly the status text and nothing else.
function handWrittenProject() {
  const project = workItemProject([{ id: 'W01', title: 'placeholder' }]);
  const file = path.join(project, 'docs', 'work-items.yaml');
  fs.writeFileSync(file, [
    'schema_version: "1.0"',
    'items:',
    '  - id: W01',
    '    title: 앱 기반 만들기',
    '    details: >-',
    '      macOS App 템플릿, Swift 6 language mode, strict concurrency complete,',
    '      외부 패키지 0개. 기능 코드는 넣지 않는다.',
    '    status: done   # finished in September',
    '    acceptance_refs: [A18]',
    '    subtasks: []',
    '  - id: W02',
    '    title: "구성 스냅샷: 값 타입"',
    '    test_strategy: >-',
    '      Domain 단위 테스트로 Node 종류별 모양을',
    '      결정표대로 확인한다.',
    '    status: pending',
    '    dependencies: [W01]',
    '    acceptance_refs: [A01, A02]',
    '    subtasks:',
    '      - id: "1"',
    '        title: 하위 항목',
    '        details: >-',
    '          둘째 줄로',
    '          접힌 문장.',
    '  - id: W03',
    '    title: 상태가 없는 항목',
    '    dependencies: [W02]',
    '',
  ].join('\n'));
  return { project, file };
}

function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  return { removed: a.filter((line, i) => line !== b[i]), lengths: [a.length, b.length] };
}

test('set-status changes only the status text of a hand-written file with folded text and flow lists', () => {
  const { project, file } = handWrittenProject();
  const before = fs.readFileSync(file, 'utf8');
  const result = run(['set-status', '--task', 'W02', '--status', 'in-progress'], project);
  assert.equal(result.status, 0, result.stderr);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, before.replace('    status: pending\n', '    status: in-progress\n'));
  assert.equal(readYaml(file).items[1].status, 'in-progress');
});

test('set-status keeps a trailing comment on the status line', () => {
  const { project, file } = handWrittenProject();
  const before = fs.readFileSync(file, 'utf8');
  // W01 is done; take W02 through to done so W01's commented line stays as it is.
  assert.equal(run(['set-status', '--task', 'W02', '--status', 'done'], project).status, 0);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /    status: done   # finished in September\n/);
  assert.equal(after, before.replace('    status: pending\n', '    status: done\n'));
});

test('set-status on a subtask of a hand-written file inserts one status line and changes nothing else', () => {
  const { project, file } = handWrittenProject();
  const before = fs.readFileSync(file, 'utf8');
  const result = run(['set-status', '--task', 'W02.1', '--status', 'in-progress'], project);
  assert.equal(result.status, 0, result.stderr);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, before.replace('      - id: "1"\n', '      - id: "1"\n        status: in-progress\n'));
  assert.equal(readYaml(file).items[1].subtasks[0].status, 'in-progress');
});

test('set-status on a hand-written item without a status inserts one line under its id', () => {
  const { project, file } = handWrittenProject();
  const before = fs.readFileSync(file, 'utf8');
  const result = run(['set-status', '--task', 'W03', '--status', 'in-progress'], project);
  assert.equal(result.status, 0, result.stderr);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, before.replace('  - id: W03\n', '  - id: W03\n    status: in-progress\n'));
  assert.equal(changedLines(before, after).lengths[1], changedLines(before, after).lengths[0] + 1);
});
