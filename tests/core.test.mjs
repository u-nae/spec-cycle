import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';
import {
  pluginRoot, cli, fixtures, run, temporaryDirectory, temporaryFixture, readYaml, writeYaml, editYaml,
  refreshFingerprint, workItemProject, defaultItems, registerCleanup,
} from './helpers.mjs';

registerCleanup();
test('all six semantic fixtures satisfy their expected route and verdict', () => {
  const result = run(['validate-fixtures', '--root', fixtures]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = YAML.parse(result.stdout);
  assert.equal(output.results.length, 6);
  assert.deepEqual(new Set(output.results.map((item) => item.fixture)), new Set(['pass', 'gherkin', 'dmn', 'both', 'needs-human', 'revise']));
  assert.ok(output.results.every((item) => item.status === 'PASS'));
});

test('fixture metrics preserve traceability and expose the small-sample caveat', () => {
  const result = run(['metrics', '--root', fixtures]);
  assert.equal(result.status, 0, result.stderr);
  const metrics = YAML.parse(result.stdout);
  assert.equal(metrics.sample.runs, 6);
  assert.equal(metrics.sample.tasks, 6);
  assert.equal(metrics.traceability_completeness, 1);
  assert.match(metrics.note, /Fixture sample only/);
});

test('full dry run preserves question, revision, READY review, and TDD handoff', () => {
  const first = run(['validate-critic', '--report', 'fixtures/dry-run/run/critic-pass-1.yaml', '--manifest', 'fixtures/dry-run/run/author-manifest-revision-0.yaml']);
  assert.equal(first.status, 0, first.stderr);
  const decisions = run(['validate-decisions', '--decision-log', 'fixtures/dry-run/run/decision-log.yaml', '--manifest', 'fixtures/dry-run/run/author-manifest-revision-0.yaml']);
  assert.equal(decisions.status, 0, decisions.stderr);
  const second = run(['validate-critic', '--report', 'fixtures/dry-run/run/critic-pass-2.yaml', '--manifest', 'fixtures/dry-run/run/author-manifest-revision-1.yaml']);
  assert.equal(second.status, 0, second.stderr);
  const handoff = readYaml(path.join(pluginRoot, 'fixtures', 'dry-run', 'run', 'tdd-handoff.yaml'));
  assert.equal(handoff.verdict, 'READY');
  assert.deepEqual(handoff.source_tasks.map((task) => task.task_id), ['5']);
  assert.equal(handoff.critic_report, 'fixtures/dry-run/run/critic-pass-2.yaml');
  assert.equal(handoff.decision_log, 'fixtures/dry-run/run/decision-log.yaml');
});

// --- init and resolve-inputs -------------------------------------------------

test('resolve-inputs fails with an init hint when the config is missing', () => {
  const project = temporaryDirectory('no-config');
  const result = run(['resolve-inputs'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /config not found/i);
  assert.match(result.stderr, /init --baseline/);
});

test('init writes the config and refuses to overwrite it', () => {
  const project = workItemProject(defaultItems);
  const config = readYaml(path.join(project, '.spec-cycle', 'config.yaml'));
  assert.deepEqual(config.baseline, ['docs/PRD.md', 'docs/TECH_STACK.md']);
  assert.equal(config.decision_records, 'docs/decisions');
  assert.equal(config.run_root, '.spec-cycle/runs');
  const again = run(['init', '--baseline', 'docs/PRD.md'], project);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /Refusing to overwrite existing config/);
});

test('init rejects a baseline document that does not exist', () => {
  const project = temporaryDirectory('init-missing');
  const result = run(['init', '--baseline', 'docs/PRD.md'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline document not found: docs\/PRD.md/);
  assert.equal(fs.existsSync(path.join(project, '.spec-cycle', 'config.yaml')), false);
});

test('resolve-inputs selects one work item and places the run under the configured run root', () => {
  const project = workItemProject(defaultItems);
  const result = run(['resolve-inputs', '--task', 'W01'], project);
  assert.equal(result.status, 0, result.stderr);
  const resolution = YAML.parse(result.stdout);
  assert.deepEqual(resolution.selected_task_ids, ['W01']);
  assert.deepEqual(resolution.warnings, []);
  assert.deepEqual(resolution.notices, []);
  assert.match(resolution.run_id, /^t-w01-[a-f0-9]{8}$/);
  assert.equal(resolution.run_dir, `.spec-cycle/runs/${resolution.run_id}`);
  assert.equal(resolution.run_dir_status, 'absent');
  assert.deepEqual(resolution.source.baseline.map((doc) => doc.path), ['docs/PRD.md', 'docs/TECH_STACK.md']);
});

test('resolve-inputs asks for human confirmation when a work item already left pending', () => {
  const project = workItemProject(defaultItems);
  const resolution = YAML.parse(run(['resolve-inputs', '--task', 'W02'], project).stdout);
  assert.ok(resolution.warnings.some((warning) => warning.includes('W02 (in-progress)')));
});

test('resolve-inputs reports untraceable work items as notices for the agent to fix', () => {
  const project = workItemProject(defaultItems);
  const missing = YAML.parse(run(['resolve-inputs', '--task', 'W03'], project).stdout);
  assert.ok(missing.notices.some((notice) => notice.includes('W03 has no source_refs')));
  assert.deepEqual(missing.warnings, []);
  const foreign = YAML.parse(run(['resolve-inputs', '--task', 'W04'], project).stdout);
  assert.ok(foreign.notices.some((notice) => notice.includes('docs/OTHER.md#x')));
});

test('resolve-inputs accepts a source_ref that points at a decision record', () => {
  const project = workItemProject(
    [{ id: 'W01', title: 'Uses a decision', source_refs: ['docs/decisions/0001-x.md'] }],
    { decisions: { '0001-x.md': '# 0001\n' } },
  );
  const resolution = YAML.parse(run(['resolve-inputs', '--task', 'W01'], project).stdout);
  assert.deepEqual(resolution.notices, []);
  assert.deepEqual(resolution.decision_record_files, ['docs/decisions/0001-x.md']);
});

test('resolve-inputs derives a new run id when a baseline document or decision record changes', () => {
  const project = workItemProject(defaultItems);
  const before = YAML.parse(run(['resolve-inputs', '--task', 'W01'], project).stdout);
  fs.appendFileSync(path.join(project, 'docs', 'TECH_STACK.md'), '\nchanged\n');
  const afterBaseline = YAML.parse(run(['resolve-inputs', '--task', 'W01'], project).stdout);
  assert.notEqual(afterBaseline.run_id, before.run_id);
  fs.writeFileSync(path.join(project, 'docs', 'decisions', '0002-new.md'), '# new\n');
  const afterDecision = YAML.parse(run(['resolve-inputs', '--task', 'W01'], project).stdout);
  assert.notEqual(afterDecision.run_id, afterBaseline.run_id);
});

test('the normalize command emitted by resolve-inputs runs verbatim', () => {
  const project = workItemProject(defaultItems);
  const resolution = YAML.parse(run(['resolve-inputs', '--task', 'W01'], project).stdout);
  const argv = resolution.normalize_command
    .replace('node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs ', '')
    .split(' ');
  const result = run(argv, project);
  assert.equal(result.status, 0, result.stderr);
  const normalized = readYaml(path.join(project, resolution.run_dir, 'normalized-tasks.yaml'));
  assert.deepEqual(normalized.source, resolution.source);
  assert.deepEqual(normalized.tasks.map((task) => task.task_id), ['W01']);
  assert.deepEqual(normalized.tasks[0].acceptance_refs, ['A04']);
  assert.equal(normalized.tasks[0].source_locator, 'work-items[id=W01]');
  const second = YAML.parse(run(['resolve-inputs', '--task', 'W01'], project).stdout);
  assert.equal(second.run_dir_status, 'exists');
});

// --- normalize ---------------------------------------------------------------

test('normalizer flattens subtasks with dotted identifiers and parent-relative dependencies', () => {
  const project = workItemProject([
    { id: 'W10', title: 'Parent', source_refs: ['docs/PRD.md'], subtasks: [
      { id: '1', title: 'First child' },
      { id: '2', title: 'Second child', dependencies: ['1'] },
    ] },
  ]);
  const result = run(['normalize', '--out', 'out/normalized.yaml', '--task', 'W10'], project);
  assert.equal(result.status, 0, result.stderr);
  const normalized = readYaml(path.join(project, 'out', 'normalized.yaml'));
  assert.deepEqual(normalized.tasks.map((task) => task.task_id), ['W10', 'W10.1', 'W10.2']);
  assert.deepEqual(normalized.tasks[2].dependencies, ['W10.1']);
  assert.equal(normalized.tasks[2].source_locator, 'work-items[id=W10].subtasks[id=2]');
});

test('normalizer rejects a work item without an identifier', () => {
  const project = workItemProject([{ title: 'Missing ID' }]);
  const result = run(['normalize', '--out', 'normalized.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing a required id/i);
});

test('normalizer rejects duplicate identifiers', () => {
  const project = workItemProject([{ id: 'W01', title: 'First' }, { id: 'W01', title: 'Duplicate' }]);
  const result = run(['normalize', '--out', 'normalized.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate identifiers/i);
});

test('normalizer rejects an identifier that would collide with subtask notation', () => {
  const project = workItemProject([{ id: 'W.1', title: 'Dotted' }]);
  const result = run(['normalize', '--out', 'normalized.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dots are reserved for subtasks/);
});

test('normalizer rejects a work item without a title', () => {
  const project = workItemProject([{ id: 'W01' }]);
  const result = run(['normalize', '--out', 'normalized.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /W01 requires a title/);
});

test('normalizer preserves and flags unknown status and priority values', () => {
  const project = workItemProject([{ id: 'W09', title: 'Unknown values', status: 'blocked', priority: 'urgent' }]);
  const result = run(['normalize', '--out', 'normalized.yaml'], project);
  assert.equal(result.status, 0, result.stderr);
  const normalized = readYaml(path.join(project, 'normalized.yaml'));
  assert.equal(normalized.tasks[0].status, 'blocked');
  assert.equal(normalized.tasks[0].priority, 'urgent');
  assert.equal(normalized.normalization_warnings.length, 2);
});

test('normalizer refuses to overwrite an existing artifact', () => {
  const project = workItemProject(defaultItems);
  const args = ['normalize', '--out', 'normalized.yaml'];
  assert.equal(run(args, project).status, 0);
  const second = run(args, project);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /Refusing to overwrite/);
});

// --- source staleness --------------------------------------------------------

test('author validation rejects a changed baseline document', () => {
  const project = temporaryFixture('pass');
  fs.appendFileSync(path.join(project, 'input', 'PRD.md'), '\nChanged after authoring.\n');
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline fingerprint is stale: input\/PRD.md/);
});

test('author validation rejects a changed work item list', () => {
  const project = temporaryFixture('gherkin');
  editYaml(path.join(project, 'input', 'work-items.yaml'), (value) => {
    value.items[0].title = 'Changed after authoring';
  });
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /work_items_fingerprint is stale/);
});

test('author validation rejects a decision record added after authoring', () => {
  const project = temporaryFixture('gherkin');
  fs.writeFileSync(path.join(project, 'input', 'decisions', '0002-later.md'), '# Later decision\n');
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /decision_records fingerprint is stale/);
});

// --- author manifest rules ---------------------------------------------------

test('BOTH author validation rejects vocabulary drift', () => {
  const project = temporaryFixture('both');
  const feature = path.join(project, 'run', 'specs', 'task-4.feature');
  fs.writeFileSync(feature, fs.readFileSync(feature, 'utf8').replaceAll('payment_approval', 'different_policy'));
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BOTH vocabulary payment_approval/);
});

test('author validation rejects an acceptance criterion that no obligation covers', () => {
  const project = temporaryFixture('both');
  editYaml(path.join(project, 'run', 'author-manifest.yaml'), (manifest) => {
    delete manifest.tasks[0].test_obligations[1].acceptance_refs;
  });
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance AC-PAY-2 is not covered/);
});

test('author validation rejects an obligation citing an acceptance criterion the work item does not list', () => {
  const project = temporaryFixture('gherkin');
  editYaml(path.join(project, 'run', 'author-manifest.yaml'), (manifest) => {
    manifest.tasks[0].test_obligations[1].acceptance_refs = ['AC-INVENTED'];
  });
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cites acceptance AC-INVENTED/);
});

test('author validation rejects acceptance references dropped from the work item', () => {
  const project = temporaryFixture('gherkin');
  editYaml(path.join(project, 'run', 'author-manifest.yaml'), (manifest) => {
    manifest.tasks[0].acceptance_refs = [];
    for (const obligation of manifest.tasks[0].test_obligations) delete obligation.acceptance_refs;
  });
  const result = run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance_refs must equal the work item's acceptance_refs/);
});

// --- questions carry the agent's proposal -------------------------------------

function editQuestion(project, edit) {
  editYaml(path.join(project, 'run', 'author-manifest.yaml'), (manifest) => edit(manifest.tasks[0].questions[0]));
  return run(['validate-author', '--manifest', 'run/author-manifest.yaml'], project);
}

test('a question without a recommended option is rejected', () => {
  const result = editQuestion(temporaryFixture('needs-human'), (question) => {
    question.recommended_default = null;
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recommended_default is required/);
});

test('a recommendation that is not one of the options is rejected', () => {
  const result = editQuestion(temporaryFixture('needs-human'), (question) => {
    question.recommended_default = 'Z';
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must name one of the option ids/);
});

test('a question without a recommendation rationale is rejected', () => {
  const result = editQuestion(temporaryFixture('needs-human'), (question) => {
    delete question.recommendation_rationale;
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recommendation_rationale is required/);
});

test('options without consequence detail are rejected', () => {
  const result = editQuestion(temporaryFixture('needs-human'), (question) => {
    question.options = ['Prohibit re-entry', 'Allow for ten minutes'];
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be an object with id, label, and detail/);
});

test('a question with a single option is rejected', () => {
  const result = editQuestion(temporaryFixture('needs-human'), (question) => {
    question.options = question.options.slice(0, 1);
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /at least two choices/);
});

// --- decision log ------------------------------------------------------------

test('decision log preserves and round-trips the original blocking question', () => {
  const result = run(['validate-decisions', '--decision-log', 'run/decision-log.yaml', '--manifest', 'run/author-manifest.yaml'], path.join(fixtures, 'needs-human'));
  assert.equal(result.status, 0, result.stderr);
});

test('decision log rejects a rewritten agent proposal', () => {
  const project = temporaryFixture('needs-human');
  editYaml(path.join(project, 'run', 'decision-log.yaml'), (log) => {
    log.decisions[0].recommended_default = 'A';
  });
  const result = run(['validate-decisions', '--decision-log', 'run/decision-log.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /preserve the agent's original proposal/);
});

test('decision log requires recording whether the human followed the proposal', () => {
  const project = temporaryFixture('needs-human');
  editYaml(path.join(project, 'run', 'decision-log.yaml'), (log) => {
    delete log.decisions[0].followed_recommendation;
  });
  const result = run(['validate-decisions', '--decision-log', 'run/decision-log.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /followed_recommendation must be boolean/);
});

// --- critic and handoff ------------------------------------------------------

test('critic validation rejects a stale reviewed manifest fingerprint', () => {
  const project = temporaryFixture('gherkin');
  fs.appendFileSync(path.join(project, 'run', 'author-manifest.yaml'), '\n# changed after review\n');
  const result = run(['validate-critic', '--report', 'run/critic-pass-1.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed_fingerprint/);
});

test('critic validation rejects a specification changed after review', () => {
  const project = temporaryFixture('gherkin');
  fs.appendFileSync(path.join(project, 'run', 'specs', 'task-2.feature'), '\n# changed after review\n');
  const result = run(['validate-critic', '--report', 'run/critic-pass-1.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed_fingerprint/);
});

test('critic validation accepts the invariant-gap category', () => {
  const project = temporaryFixture('gherkin');
  editYaml(path.join(project, 'run', 'critic-pass-1.yaml'), (report) => {
    report.findings = [{
      finding_id: 'F-2-invariant',
      task_id: '2',
      severity: 'minor',
      category: 'invariant-gap',
      evidence: 'input/PRD.md#session-entry',
      explanation: 'Example invariant observation.',
      requested_change: 'Mention the invariant in a scenario.',
      requires_human: false,
    }];
    report.summary.minor_count = 1;
  });
  const result = run(['validate-critic', '--report', 'run/critic-pass-1.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.equal(result.status, 0, result.stderr);
});

test('critic cannot mark READY while the author manifest retains an unanswered blocking question', () => {
  const project = temporaryFixture('needs-human');
  editYaml(path.join(project, 'run', 'critic-pass-1.yaml'), (report) => {
    report.verdict = 'READY';
    report.findings = [];
    report.questions = [];
    report.summary = { critical_count: 0, major_count: 0, minor_count: 0, note_count: 0 };
  });
  const result = run(['validate-critic', '--report', 'run/critic-pass-1.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /READY cannot retain/);
});

test('critic questions must carry a proposal too', () => {
  const project = temporaryFixture('needs-human');
  editYaml(path.join(project, 'run', 'critic-pass-1.yaml'), (report) => {
    report.questions[0].recommended_default = null;
  });
  const result = run(['validate-critic', '--report', 'run/critic-pass-1.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /questions\[0\]\.recommended_default is required/);
});

test('final critic pass cannot request another revision', () => {
  const project = temporaryFixture('revise');
  editYaml(path.join(project, 'run', 'author-manifest.yaml'), (manifest) => {
    manifest.revision_count = 2;
  });
  editYaml(path.join(project, 'run', 'critic-pass-1.yaml'), (report) => {
    report.critic_pass = 3;
  });
  refreshFingerprint(project);
  const result = run(['validate-critic', '--report', 'run/critic-pass-1.yaml', '--manifest', 'run/author-manifest.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BLOCKED_AT_LIMIT/);
});

test('non-READY verdict blocks TDD handoff', () => {
  const project = temporaryFixture('revise');
  const result = run(['build-handoff', '--manifest', 'run/author-manifest.yaml', '--report', 'run/critic-pass-1.yaml', '--out', 'run/tdd-handoff.yaml'], project);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked by verdict REVISE/);
  assert.equal(fs.existsSync(path.join(project, 'run', 'tdd-handoff.yaml')), false);
});

test('READY verdict creates a handoff with acceptance coverage and refuses a collision', () => {
  const project = temporaryFixture('both');
  const args = ['build-handoff', '--manifest', 'run/author-manifest.yaml', '--report', 'run/critic-pass-1.yaml', '--out', 'run/tdd-handoff.yaml'];
  const first = run(args, project);
  assert.equal(first.status, 0, first.stderr);
  const handoff = readYaml(path.join(project, 'run', 'tdd-handoff.yaml'));
  assert.equal(handoff.verdict, 'READY');
  assert.deepEqual(handoff.source_tasks, [{ task_id: '4', title: 'Process payment through approval policy', route: 'BOTH', acceptance_refs: ['AC-PAY-1', 'AC-PAY-2'] }]);
  assert.deepEqual(handoff.acceptance_coverage, { 'AC-PAY-1': ['T4-flow'], 'AC-PAY-2': ['T4-policy'] });
  assert.equal(handoff.source.work_items_artifact, 'input/work-items.yaml');
  const second = run(args, project);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /Refusing to overwrite existing handoff/);
});

test('an empty work-item list points to the work-items skill instead of a null filter', () => {
  const project = workItemProject([]);
  for (const args of [['resolve-inputs'], ['normalize', '--out', 'normalized.yaml']]) {
    const result = run(args, project);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Work item list is empty: docs\/work-items.yaml/);
    assert.doesNotMatch(result.stderr, /null/);
  }
});

// --- bundled dependencies ---------------------------------------------------

test('missing bundled node_modules produce a clear message and exit code 1', () => {
  const plugin = temporaryDirectory('no-modules');
  fs.cpSync(path.join(pluginRoot, 'scripts'), path.join(plugin, 'scripts'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'spec-cycle.mjs'), 'fingerprint', '--file', 'x'], {
    cwd: plugin,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    'spec-cycle: bundled node_modules are missing from this plugin install; reinstall the plugin or run npm install in the plugin directory',
  );
});
