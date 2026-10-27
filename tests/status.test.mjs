import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {
  editYaml, fixtures, handoffProject, pluginRoot, readYaml, registerCleanup, run, temporaryDirectory, workItemProject, writeRun, writeYaml,
} from './helpers.mjs';

registerCleanup();

const SNAPSHOT = path.join('.spec-cycle', 'status.json');
const SNAPSHOT_KEYS = ['schema_version', 'generated_at', 'generated_by', 'config', 'inputs', 'items'];
const ITEM_KEYS = [
  'id', 'parent_id', 'title', 'status', 'priority', 'dependencies', 'dependencies_done', 'external_ref', 'run', 'handoff', 'verification',
];
const RUN_KEYS = [
  'id', 'dir', 'updated_at', 'revision_count', 'max_revisions', 'critic_passes', 'verdict', 'findings', 'open_questions', 'route', 'artifacts',
];

function statusJson(project, extra = []) {
  const result = run(['status', '--json', ...extra], project);
  assert.equal(result.status, 0, result.stderr);
  return { result, snapshot: JSON.parse(result.stdout) };
}

function snapshotFile(project) {
  return JSON.parse(fs.readFileSync(path.join(project, SNAPSHOT), 'utf8'));
}

// A run whose author manifest and critic report carry the fields the snapshot reads.
function describeRun(runDir, { revision = 1, verdict = 'READY', questions = [], findings = {} } = {}) {
  writeYaml(path.join(runDir, `author-manifest-revision-${revision}.yaml`), {
    revision_count: revision,
    max_revisions: 2,
    tasks: [{ task_id: 'W01', route: 'GHERKIN', spec_files: [`.spec-cycle/runs/${path.basename(runDir)}/specs/revision-${revision}/task-W01.feature`] }],
  });
  writeYaml(path.join(runDir, 'critic-pass-1.yaml'), { verdict: 'REVISE', summary: { critical_count: 0, major_count: 1, minor_count: 0, note_count: 0 } });
  writeYaml(path.join(runDir, 'critic-pass-2.yaml'), {
    verdict,
    questions,
    summary: { critical_count: 0, major_count: 0, minor_count: 2, note_count: 1, ...findings },
  });
}

test('status --json writes a schema 1.0 snapshot to stdout and leaves the YAML status untouched', () => {
  const { project, runDir } = handoffProject();
  describeRun(runDir);
  fs.mkdirSync(path.join(runDir, 'specs', 'revision-1'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'specs', 'revision-1', 'task-W01.feature'), 'Feature: x\n');
  const yamlBefore = run(['status'], project).stdout;

  const { snapshot } = statusJson(project);
  assert.deepEqual(Object.keys(snapshot), SNAPSHOT_KEYS);
  assert.equal(snapshot.schema_version, '1.0');
  assert.match(snapshot.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(snapshot.generated_by, /^spec-cycle@\d+\.\d+\.\d+ status$/);
  assert.deepEqual(snapshot.config, {
    path: '.spec-cycle/config.yaml', intake: 'native', execution: 'inline', run_root: '.spec-cycle/runs', work_items: 'docs/work-items.yaml',
  });
  assert.deepEqual(snapshot.inputs.map((input) => input.path), ['docs/PRD.md', 'docs/TECH_STACK.md', 'docs/work-items.yaml', 'docs/decisions']);
  assert.deepEqual(snapshot.inputs.map((input) => input.kind ?? null), [null, null, null, 'dir-max']);
  for (const input of snapshot.inputs) assert.equal(Number.isInteger(input.mtime_ms), true, JSON.stringify(input));

  assert.deepEqual(snapshot.items.map((item) => item.id), ['W01', 'W02', 'W03', 'W04']);
  const first = snapshot.items[0];
  assert.deepEqual(Object.keys(first), ITEM_KEYS);
  assert.deepEqual(Object.keys(first.run), RUN_KEYS);
  assert.equal(first.parent_id, null);
  assert.equal(first.external_ref, null);
  assert.equal(first.dependencies_done, true);
  assert.equal(first.run.id, 't-w01-aaaa');
  assert.equal(first.run.dir, '.spec-cycle/runs/t-w01-aaaa');
  assert.match(first.run.updated_at, /Z$/);
  assert.equal(first.run.revision_count, 1);
  assert.equal(first.run.max_revisions, 2);
  assert.equal(first.run.critic_passes, 2);
  assert.equal(first.run.verdict, 'READY');
  assert.deepEqual(first.run.findings, { critical: 0, major: 0, minor: 2, note: 1 });
  assert.deepEqual(first.run.open_questions, []);
  assert.equal(first.run.route, 'GHERKIN');
  assert.deepEqual(first.run.artifacts, {
    handoff: '.spec-cycle/runs/t-w01-aaaa/tdd-handoff.yaml',
    brief: null,
    verification: null,
    decision_log: null,
    critic_reports: ['.spec-cycle/runs/t-w01-aaaa/critic-pass-1.yaml', '.spec-cycle/runs/t-w01-aaaa/critic-pass-2.yaml'],
    spec_files: ['.spec-cycle/runs/t-w01-aaaa/specs/revision-1/task-W01.feature'],
  });
  assert.deepEqual(first.handoff, { usable: true, errors: [], warnings: [], obligations_total: 0 });
  assert.equal(first.verification, null);

  const second = snapshot.items[1];
  assert.equal(second.status, 'in-progress');
  assert.equal(second.run, null);
  assert.equal(second.handoff, null);
  assert.equal(second.verification, null);

  assert.equal(run(['status'], project).stdout, yamlBefore);
  assert.doesNotMatch(yamlBefore, /schema_version/);
});

test('status --json without --write does not touch the stored snapshot', () => {
  const { project } = handoffProject();
  const file = path.join(project, SNAPSHOT);
  fs.writeFileSync(file, '{"stale": true}\n');
  statusJson(project);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"stale": true}\n');
});

test('status --json places subtasks after their parent and marks unmet dependencies', () => {
  const project = workItemProject([
    { id: 'W01', title: 'Parent', status: 'pending', source_refs: ['docs/PRD.md#F05'], subtasks: [{ id: '1', title: 'Child', dependencies: ['2'] }, { id: '2', title: 'Other child' }] },
    { id: 'W02', title: 'Blocked', status: 'pending', dependencies: ['W01'], external_ref: 'TM-7' },
  ]);
  const { snapshot } = statusJson(project);
  assert.deepEqual(snapshot.items.map((item) => [item.id, item.parent_id, item.dependencies_done]), [
    ['W01', null, true], ['W01.1', 'W01', false], ['W01.2', 'W01', true], ['W02', null, false],
  ]);
  assert.equal(snapshot.items[3].external_ref, 'TM-7');
  assert.deepEqual(snapshot.items[1].dependencies, ['W01.2']);
});

test('status --json on an empty work-item list yields no items instead of failing', () => {
  const project = workItemProject([]);
  const { snapshot } = statusJson(project);
  assert.deepEqual(snapshot.items, []);
  assert.equal(run(['status'], project).status, 1);
});

test('status --json --write stores the same document atomically beside the config', () => {
  const { project } = handoffProject();
  const { result } = statusJson(project, ['--write']);
  const stored = snapshotFile(project);
  assert.deepEqual(stored, JSON.parse(result.stdout));
  assert.equal(stored.generated_by.endsWith(' status --write'), true, stored.generated_by);
  assert.deepEqual(fs.readdirSync(path.join(project, '.spec-cycle')).sort(), ['config.yaml', 'runs', 'status.json']);
  assert.equal(fs.readFileSync(path.join(project, SNAPSHOT), 'utf8').endsWith('\n'), true);
});

test('status --json omits an input that does not exist yet and keeps a dir-max mtime at the newest file', () => {
  const project = workItemProject([{ id: 'W01', title: 'x', status: 'pending', source_refs: ['docs/PRD.md#F05'] }]);
  fs.rmSync(path.join(project, 'docs', 'decisions'), { recursive: true });
  let { snapshot } = statusJson(project);
  assert.deepEqual(snapshot.inputs.map((input) => input.path), ['docs/PRD.md', 'docs/TECH_STACK.md', 'docs/work-items.yaml']);

  fs.mkdirSync(path.join(project, 'docs', 'decisions', 'nested'), { recursive: true });
  const newest = path.join(project, 'docs', 'decisions', 'nested', '0002.md');
  fs.writeFileSync(path.join(project, 'docs', 'decisions', '0001.md'), '# 1\n');
  fs.writeFileSync(newest, '# 2\n');
  fs.utimesSync(path.join(project, 'docs', 'decisions', '0001.md'), 1_600_000_000, 1_600_000_000);
  fs.utimesSync(newest, 1_700_000_000, 1_700_000_000);
  fs.utimesSync(path.join(project, 'docs', 'decisions', 'nested'), 1_650_000_000, 1_650_000_000);
  fs.utimesSync(path.join(project, 'docs', 'decisions'), 1_500_000_000, 1_500_000_000);
  ({ snapshot } = statusJson(project));
  const records = snapshot.inputs.find((input) => input.path === 'docs/decisions');
  assert.equal(records.kind, 'dir-max');
  assert.equal(records.mtime_ms, 1_700_000_000_000);
});

test('status --json lists only the unanswered questions of a NEEDS_HUMAN run with the recommended label', () => {
  const { project, runDir, handoffFile } = handoffProject();
  fs.rmSync(handoffFile);
  const question = (id, answer) => ({
    question_id: id, task_id: 'W01', blocking: true, question: `Question ${id}?`,
    options: [{ id: 'A', label: 'Keep', detail: 'd' }, { id: 'B', label: 'Drop', detail: 'd' }],
    recommended_default: 'B', recommendation_rationale: 'B reverses easily.', answer, answer_source: answer ? 'AskUserQuestion' : null,
  });
  const other = { ...question('Q-W02-1', null), task_id: 'W02' };
  describeRun(runDir, { verdict: 'NEEDS_HUMAN', questions: [question('Q-W01-1', null), question('Q-W01-2', 'A'), other] });

  let { snapshot } = statusJson(project);
  assert.equal(snapshot.items[0].run.verdict, 'NEEDS_HUMAN');
  assert.deepEqual(snapshot.items[0].run.open_questions, [{
    question_id: 'Q-W01-1', question: 'Question Q-W01-1?', blocking: true, recommended_default: 'B', recommended_label: 'Drop',
    recommendation_rationale: 'B reverses easily.',
  }]);
  assert.equal(snapshot.items[0].handoff, null);
  assert.equal(snapshot.items[0].run.artifacts.handoff, null);

  // questions.yaml, when present, is the question source; a decision-log entry also counts as an answer.
  writeYaml(path.join(runDir, 'questions.yaml'), { questions: [question('Q-W01-1', null), question('Q-W01-3', null)] });
  writeYaml(path.join(runDir, 'decision-log.yaml'), { decisions: [{ question_id: 'Q-W01-3', answer: 'A' }] });
  ({ snapshot } = statusJson(project));
  assert.deepEqual(snapshot.items[0].run.open_questions.map((q) => q.question_id), ['Q-W01-1']);
  assert.equal(snapshot.items[0].run.artifacts.decision_log, '.spec-cycle/runs/t-w01-aaaa/decision-log.yaml');
});

test('status --json reports an invalidated handoff exactly as resolve-handoff does', () => {
  const { project } = handoffProject();
  fs.appendFileSync(path.join(project, 'docs', 'PRD.md'), 'changed\n');
  const resolution = YAML.parse(run(['resolve-handoff', '--task', 'W01'], project).stdout);
  assert.equal(resolution.usable, false);
  const { snapshot } = statusJson(project);
  assert.deepEqual(snapshot.items[0].handoff, {
    usable: false, errors: resolution.errors, warnings: resolution.warnings, obligations_total: 0,
  });
});

test('status --json summarizes verification.yaml and counts the obligations of the task', () => {
  const { project, runDir, handoffFile } = handoffProject();
  editYaml(handoffFile, (handoff) => {
    handoff.test_obligations = [{ obligation_id: 'W01-a', task_id: 'W01' }, { obligation_id: 'W01-b', task_id: 'W01' }];
  });
  writeYaml(path.join(runDir, 'verification.yaml'), {
    checked_at: '2026-10-27T01:02:03.000Z',
    obligations: [{ obligation_id: 'W01-a', covered: true }, { obligation_id: 'W01-b', covered: false }],
    test_command: { command: 'npm test', exit_code: 1 },
    human_confirmed_tests: null,
    status_written: null,
  });
  let { snapshot } = statusJson(project);
  assert.equal(snapshot.items[0].handoff.obligations_total, 2);
  assert.deepEqual(snapshot.items[0].verification, { covered: 1, total: 2, checked_at: '2026-10-27T01:02:03.000Z', tests: 'failed', status_written: null });
  assert.equal(snapshot.items[0].run.artifacts.verification, '.spec-cycle/runs/t-w01-aaaa/verification.yaml');

  editYaml(path.join(runDir, 'verification.yaml'), (report) => {
    report.test_command = null;
    report.human_confirmed_tests = true;
    report.status_written = 'done';
  });
  ({ snapshot } = statusJson(project));
  assert.equal(snapshot.items[0].verification.tests, 'confirmed');
  assert.equal(snapshot.items[0].verification.status_written, 'done');

  editYaml(path.join(runDir, 'verification.yaml'), (report) => {
    report.human_confirmed_tests = null;
  });
  ({ snapshot } = statusJson(project));
  assert.equal(snapshot.items[0].verification.tests, 'unknown');
});

test('state-changing subcommands refresh the snapshot and name themselves in generated_by', () => {
  const project = workItemProject([{ id: 'W01', title: 'x', status: 'pending', source_refs: ['docs/PRD.md#F05'] }]);
  // init already ran inside workItemProject.
  assert.equal(snapshotFile(project).generated_by.endsWith(' init'), true);

  const set = run(['set-status', '--task', 'W01', '--status', 'in-progress'], project);
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stderr, '');
  let stored = snapshotFile(project);
  assert.equal(stored.generated_by.endsWith(' set-status'), true, stored.generated_by);
  assert.equal(stored.items[0].status, 'in-progress');

  const resolved = run(['resolve-inputs', '--task', 'W01'], project);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(snapshotFile(project).generated_by.endsWith(' resolve-inputs'), true);

  const normalized = run(['normalize', '--out', '.spec-cycle/runs/t-w01-1/normalized-tasks.yaml', '--task', 'W01'], project);
  assert.equal(normalized.status, 0, normalized.stderr);
  stored = snapshotFile(project);
  assert.equal(stored.generated_by.endsWith(' normalize'), true);
  assert.equal(stored.items[0].run.id, 't-w01-1');
  assert.equal(stored.items[0].run.verdict, null);
});

test('read-only subcommands do not write a snapshot', () => {
  const { project } = handoffProject();
  fs.rmSync(path.join(project, SNAPSHOT));
  for (const args of [['status'], ['detect'], ['resolve-handoff', '--task', 'W01'], ['fingerprint', '--file', 'docs/PRD.md']]) {
    const result = run(args, project);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  }
  assert.equal(fs.existsSync(path.join(project, SNAPSHOT)), false);
});

test('verify-obligations refreshes the snapshot even when it reports uncovered obligations', () => {
  const { project, handoffFile } = handoffProject();
  editYaml(handoffFile, (handoff) => {
    handoff.test_obligations = [{ obligation_id: 'W01-x', task_id: 'W01' }];
  });
  editYaml(path.join(project, '.spec-cycle', 'config.yaml'), (config) => {
    config.verification = { test_globs: ['tests/**/*.mjs'], id_pattern: null, test_command: null };
  });
  fs.mkdirSync(path.join(project, 'tests'));
  fs.writeFileSync(path.join(project, 'tests', 'A.test.mjs'), "test('nothing', () => {});\n");
  const result = run(['verify-obligations', '--task', 'W01'], project);
  assert.equal(result.status, 1);
  const stored = snapshotFile(project);
  assert.equal(stored.generated_by.endsWith(' verify-obligations'), true, stored.generated_by);
  assert.deepEqual(stored.items[0].verification, { covered: 0, total: 1, checked_at: stored.items[0].verification.checked_at, tests: 'unknown', status_written: null });
});

test('validate-author refreshes the snapshot of the project the manifest belongs to, and stays quiet elsewhere', () => {
  // The pass fixture validated from the plugin root: no .spec-cycle/config.yaml above it, so nothing is written or said.
  const quiet = run(['validate-author', '--manifest', path.join(fixtures, 'pass', 'run', 'author-manifest.yaml')]);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stderr, '');
  assert.equal(fs.existsSync(path.join(pluginRoot, SNAPSHOT)), false);

  // The same fixture copied under a project whose config points at it: the manifest's project is found by walking up.
  const project = temporaryDirectory('fixture-project');
  fs.cpSync(path.join(fixtures, 'pass'), project, { recursive: true });
  writeYaml(path.join(project, '.spec-cycle', 'config.yaml'), {
    schema_version: '1.0', baseline: ['input/PRD.md'], decision_records: null, work_items: 'input/work-items.yaml', run_root: 'run',
  });
  const loud = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.equal(loud.status, 0, loud.stderr);
  assert.equal(loud.stderr, '');
  assert.equal(loud.stdout, 'author manifest valid\n');
  assert.equal(snapshotFile(project).generated_by.endsWith(' validate-author'), true);
});

test('a snapshot write failure leaves the exit code and stdout of the command unchanged', () => {
  const project = workItemProject([{ id: 'W01', title: 'x', status: 'pending', source_refs: ['docs/PRD.md#F05'] }]);
  fs.rmSync(path.join(project, SNAPSHOT));
  fs.mkdirSync(path.join(project, SNAPSHOT));
  const result = run(['set-status', '--task', 'W01', '--status', 'in-progress'], project);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'task_id: W01\nfrom: pending\nto: in-progress\n');
  assert.match(result.stderr, /^spec-cycle: status snapshot not written \(.*\)\n$/);
  assert.equal(readYaml(path.join(project, 'docs', 'work-items.yaml')).items[0].status, 'in-progress');
  assert.deepEqual(fs.readdirSync(path.join(project, '.spec-cycle')).sort(), ['config.yaml', 'status.json']);
});

test('resolve-inputs recommends ignoring the snapshot', () => {
  const project = workItemProject([{ id: 'W01', title: 'x', status: 'pending', source_refs: ['docs/PRD.md#F05'] }]);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: project }).status, 0);
  const result = run(['resolve-inputs', '--task', 'W01'], project);
  assert.equal(result.status, 0, result.stderr);
  const hint = YAML.parse(result.stdout).gitignore_hint;
  assert.deepEqual(hint.split('\n').slice(-2), ['.spec-cycle/runs/*/critic-pass-*.yaml', '.spec-cycle/status.json']);
});

// --- fixture goldens ---------------------------------------------------------
// Each fixture keeps its run flat under run/; the snapshot reads <run_root>/<run_id>/, so the copy is
// laid out that way. Volatile fields (times, mtimes) are pinned before comparing with tests/golden/status/.
const GOLDEN_DIR = path.join(pluginRoot, 'tests', 'golden', 'status');

function fixtureProject(name) {
  const project = temporaryDirectory(`golden-${name}`);
  fs.cpSync(path.join(fixtures, name), project, { recursive: true });
  const runId = readYaml(path.join(project, 'run', 'author-manifest.yaml')).run_id;
  const flat = path.join(project, 'run');
  const nested = path.join(project, 'run', runId);
  fs.mkdirSync(nested);
  for (const name of fs.readdirSync(flat)) {
    if (name !== runId) fs.renameSync(path.join(flat, name), path.join(nested, name));
  }
  return project;
}

function pinned(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  copy.generated_at = '<generated_at>';
  copy.generated_by = copy.generated_by.replace(/@\d+\.\d+\.\d+ /, '@<version> ');
  for (const input of copy.inputs) input.mtime_ms = 0;
  for (const item of copy.items) {
    if (item.run) item.run.updated_at = '<updated_at>';
    if (item.verification) item.verification.checked_at = '<checked_at>';
  }
  return copy;
}

for (const name of fs.readdirSync(fixtures).sort()) {
  test(`status --json matches the golden snapshot of the ${name} fixture`, () => {
    const project = fixtureProject(name);
    const { snapshot } = statusJson(project, ['--config', 'input/config.yaml']);
    const actual = `${JSON.stringify(pinned(snapshot), null, 2)}\n`;
    const goldenFile = path.join(GOLDEN_DIR, `${name}.json`);
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(goldenFile, actual);
    }
    assert.equal(fs.existsSync(goldenFile), true, `missing ${goldenFile}; run with UPDATE_GOLDEN=1 and review the diff`);
    assert.equal(actual, fs.readFileSync(goldenFile, 'utf8'));
  });
}
