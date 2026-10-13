import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { editYaml, handoffProject, readYaml, registerCleanup, run, writeRun, writeYaml } from './helpers.mjs';

registerCleanup();

// A project with a READY handoff for W01 carrying the given obligation ids and a configured test glob.
function verifyProject(ids = ['W01-rename-records-revision'], options, idPattern = null) {
  const built = handoffProject(options);
  editYaml(built.handoffFile, (handoff) => {
    handoff.test_obligations = ids.map((id) => ({ obligation_id: id }));
  });
  editYaml(path.join(built.project, '.spec-cycle', 'config.yaml'), (config) => {
    config.verification = { test_globs: ['tests/**/*.mjs'], id_pattern: idPattern, test_command: null };
  });
  return built;
}

function writeTest(project, name, body) {
  const file = path.join(project, 'tests', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function verify(project, extra = []) {
  const result = run(['verify-obligations', '--task', 'W01', ...extra], project);
  return { result, report: result.stdout ? YAML.parse(result.stdout) : null };
}

test('verify-obligations reports covered and uncovered obligations with locations', () => {
  const { project, runDir } = verifyProject(['W01-rename-records-revision', 'W01-other']);
  writeTest(project, 'A.test.mjs', "// header\n\ntest('W01-rename-records-revision', () => {});\n");
  const { result, report } = verify(project);
  assert.equal(result.status, 1);
  assert.deepEqual(report.obligations, [
    { obligation_id: 'W01-rename-records-revision', covered: true, locations: ['tests/A.test.mjs:3'] },
    { obligation_id: 'W01-other', covered: false, locations: [] },
  ]);
  assert.deepEqual(Object.keys(report), [
    'schema_version', 'run_id', 'task_id', 'checked_at', 'test_globs', 'obligations', 'uncovered_count', 'test_command', 'status_written',
  ]);
  assert.equal(report.uncovered_count, 1);
  assert.equal(report.run_id, 't-w01-aaaa');
  assert.equal(report.test_command, null);
  assert.equal(report.status_written, null);
  assert.match(result.stderr, /- obligation W01-other is not covered by any test/);
  assert.deepEqual(readYaml(path.join(runDir, 'verification.yaml')).obligations, report.obligations);
});

test('verify-obligations does not count a prefix match as coverage', () => {
  const { project } = verifyProject(['W01-x']);
  writeTest(project, 'A.test.mjs', "test('W01-x-10', () => {});\ntest('W01-x0', () => {});\n");
  const { result, report } = verify(project);
  assert.equal(result.status, 1);
  assert.equal(report.obligations[0].covered, false);
  assert.equal(report.uncovered_count, 1);
});

test('verify-obligations ignores matches outside test_globs', () => {
  const { project } = verifyProject(['W01-x']);
  writeTest(project, 'A.test.mjs', "test('nothing', () => {});\n");
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'notes.mjs'), '// W01-x\n');
  const { result, report } = verify(project);
  assert.equal(result.status, 1);
  assert.equal(report.obligations[0].covered, false);
});

test('verify-obligations fails when test_globs match no files', () => {
  const { project, runDir } = verifyProject(['W01-x']);
  const result = run(['verify-obligations', '--task', 'W01'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /- verification\.test_globs matched no files; set it in \.spec-cycle\/config\.yaml/);
  assert.equal(fs.existsSync(path.join(runDir, 'verification.yaml')), false);

  editYaml(path.join(project, '.spec-cycle', 'config.yaml'), (config) => {
    config.verification.test_globs = [];
  });
  const empty = run(['verify-obligations', '--task', 'W01'], project);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /matched no files/);
});

test('verify-obligations applies id_pattern with {id} substitution', () => {
  const { project } = verifyProject(['W01-a.b', 'W01-c'], undefined, '@Test\\("\\[{id}\\]');
  writeTest(project, 'Sample.mjs', '    @Test("[W01-a.b] renames")\n    // W01-c mentioned without the marker\n    @Test("[W01-aXb] other")\n');
  const { report } = verify(project);
  assert.deepEqual(report.obligations, [
    { obligation_id: 'W01-a.b', covered: true, locations: ['tests/Sample.mjs:1'] },
    { obligation_id: 'W01-c', covered: false, locations: [] },
  ]);
});

test('verify-obligations --mark-done writes done only when nothing is uncovered', () => {
  const { project, runDir } = verifyProject(['W01-x', 'W01-y']);
  writeTest(project, 'A.test.mjs', "test('W01-x', () => {});\n");
  const workItems = path.join(project, 'docs', 'work-items.yaml');
  const failed = verify(project, ['--mark-done']);
  assert.equal(failed.result.status, 1);
  assert.match(failed.result.stderr, /1 obligation\(s\) uncovered; status unchanged/);
  assert.equal(readYaml(workItems).items.find((item) => item.id === 'W01').status, 'pending');
  assert.equal(readYaml(path.join(runDir, 'verification.yaml')).status_written, null);

  writeTest(project, 'B.test.mjs', "test('W01-y', () => {});\n");
  const passed = verify(project, ['--mark-done']);
  assert.equal(passed.result.status, 0, passed.result.stderr);
  assert.equal(passed.report.status_written, 'done');
  assert.equal(readYaml(workItems).items.find((item) => item.id === 'W01').status, 'done');
  assert.equal(readYaml(path.join(runDir, 'verification.yaml')).status_written, 'done');

  const again = verify(project, ['--mark-done']);
  assert.equal(again.result.status, 0, again.result.stderr);
  assert.equal(again.report.status_written, 'done');
});

test('verify-obligations reads a 1.0 handoff', () => {
  const { project } = verifyProject(['W01-x'], { schemaVersion: '1.0', decisionVectors: false });
  writeTest(project, 'A.test.mjs', "test('W01-x', () => {});\n");
  const { result, report } = verify(project, ['--out', 'out/report.yaml']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.uncovered_count, 0);
  assert.equal(readYaml(path.join(project, 'out', 'report.yaml')).task_id, 'W01');
});

test('status lists each work item with its latest run verdict and coverage', () => {
  const { project, runDir } = verifyProject(['W01-x']);
  writeYaml(path.join(runDir, 'critic-pass-1.yaml'), { verdict: 'REVISE' });
  writeYaml(path.join(runDir, 'critic-pass-2.yaml'), { verdict: 'READY' });
  writeYaml(path.join(runDir, 'verification.yaml'), {
    obligations: [{ obligation_id: 'W01-x', covered: true, locations: ['tests/A.test.mjs:1'] }],
  });
  const result = run(['status'], project);
  assert.equal(result.status, 0, result.stderr);
  const rows = YAML.parse(result.stdout);
  assert.deepEqual(rows.map((row) => row.id), ['W01', 'W02', 'W03', 'W04']);
  assert.deepEqual(rows[0], {
    id: 'W01', title: 'Record revisions', status: 'pending', latest_run: 't-w01-aaaa', verdict: 'READY', handoff: true, coverage: '1/1',
  });
  assert.deepEqual(rows[1], {
    id: 'W02', title: 'Already started', status: 'in-progress', latest_run: null, verdict: null, handoff: false, coverage: null,
  });
});

test('status reports the newest run, not the run with the most critic passes', () => {
  const { project, runDir, handoffFile } = verifyProject(['W01-x']);
  // An older re-gate that stopped at the pass limit; its name sorts after the current run on purpose.
  const older = writeRun(project, 't-w01-zzzz');
  fs.rmSync(older.handoffFile);
  writeYaml(path.join(older.runDir, 'critic-pass-1.yaml'), { verdict: 'REVISE' });
  writeYaml(path.join(older.runDir, 'critic-pass-2.yaml'), { verdict: 'BLOCKED_AT_LIMIT' });
  for (const name of fs.readdirSync(older.runDir)) fs.utimesSync(path.join(older.runDir, name), 1_600_000_000, 1_600_000_000);

  writeYaml(path.join(runDir, 'critic-pass-1.yaml'), { verdict: 'READY' });
  writeYaml(path.join(runDir, 'verification.yaml'), {
    obligations: [{ obligation_id: 'W01-x', covered: true, locations: ['tests/A.test.mjs:1'] }],
  });
  fs.utimesSync(handoffFile, 1_700_000_000, 1_700_000_000);

  const result = run(['status'], project);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(YAML.parse(result.stdout)[0], {
    id: 'W01', title: 'Record revisions', status: 'pending', latest_run: 't-w01-aaaa', verdict: 'READY', handoff: true, coverage: '1/1',
  });
  assert.equal(run(['resolve-handoff', '--task', 'W01'], project).stdout.includes('run_id: t-w01-aaaa'), true);

  // Once the older run becomes the newest, status follows it.
  for (const name of fs.readdirSync(older.runDir)) fs.utimesSync(path.join(older.runDir, name), 1_800_000_000, 1_800_000_000);
  const later = YAML.parse(run(['status'], project).stdout)[0];
  assert.equal(later.latest_run, 't-w01-zzzz');
  assert.equal(later.verdict, 'BLOCKED_AT_LIMIT');
  assert.equal(later.handoff, false);
});
