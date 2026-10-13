import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { run, temporaryDirectory, writeYaml, registerCleanup } from './helpers.mjs';
import {
  evaluateTable, vectorsArtifact, obligationIdFor, MAX_CELLS, MISSING,
} from '../scripts/lib/decision.mjs';
import YAML from 'yaml';

registerCleanup();

function table(overrides = {}) {
  return {
    schema_version: '1.0',
    task_id: 'T1',
    decision_id: 'pick',
    execution_format: 'table-v1',
    hit_policy: 'UNIQUE',
    ordered_rules: false,
    inputs: [
      { name: 'a', type: 'string', allowed_values: ['x', 'y'], blank_means: 'any' },
      { name: 'b', type: 'string', allowed_values: ['p', 'q'], blank_means: 'any' },
    ],
    outputs: [{ name: 'out', type: 'string', allowed_values: ['one', 'two', 'three', 'four'] }],
    rules: [
      { rule_id: 'R1', when: { a: 'x', b: 'p' }, then: { out: 'one' } },
      { rule_id: 'R2', when: { a: 'x', b: 'q' }, then: { out: 'two' } },
      { rule_id: 'R3', when: { a: 'y', b: 'p' }, then: { out: 'three' } },
      { rule_id: 'R4', when: { a: 'y', b: 'q' }, then: { out: 'four' } },
    ],
    default_rule: null,
    gap_analysis: [],
    overlap_analysis: [],
    ...overrides,
  };
}

function w06() {
  return {
    schema_version: '1.0',
    task_id: 'W06',
    decision_id: 'bookmark_failure_cause',
    execution_format: 'table-v1',
    hit_policy: 'FIRST',
    ordered_rules: true,
    inputs: [
      { name: 'volume_state', type: 'string', allowed_values: ['mounted', 'unmounted', 'unknown'], blank_means: 'any' },
      { name: 'error_kind', type: 'string', allowed_values: ['no_such_file', 'no_permission', 'other'], blank_means: 'any' },
    ],
    outputs: [{ name: 'cause', type: 'string', allowed_values: ['volume_unavailable', 'missing', 'access_denied', 'check_failed'] }],
    rules: [
      { rule_id: 'R1', when: { volume_state: 'unmounted' }, then: { cause: 'volume_unavailable' } },
      { rule_id: 'R2', when: { error_kind: 'no_permission' }, then: { cause: 'access_denied' } },
      { rule_id: 'R3', when: { volume_state: 'mounted', error_kind: 'no_such_file' }, then: { cause: 'missing' } },
      { rule_id: 'R4', when: { volume_state: 'unknown', error_kind: 'no_such_file' }, then: { cause: 'check_failed' } },
      { rule_id: 'R5', when: { error_kind: 'other' }, then: { cause: 'check_failed' } },
    ],
    default_rule: null,
    gap_analysis: [],
    overlap_analysis: ['unmounted dominates every error kind'],
  };
}

const byId = (evaluation, id) => evaluation.rules.find((rule) => rule.rule_id === id);

test('UNIQUE table with full coverage has no gaps or overlaps and one win per cell', () => {
  const result = evaluateTable(table());
  assert.deepEqual(result.errors, []);
  assert.equal(result.cells_total, 4);
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.overlaps, []);
  for (const rule of result.rules) assert.equal(rule.wins.length, 1);
  assert.deepEqual(byId(result, 'R2').wins[0], { inputs: { a: 'x', b: 'q' }, expected: { out: 'two' } });
});

test('UNIQUE table reports a gap cell when no rule and no default matches', () => {
  const decision = table();
  decision.rules = decision.rules.slice(0, 3);
  const result = evaluateTable(decision);
  assert.deepEqual(result.gaps, [{ inputs: { a: 'y', b: 'q' } }]);
  assert.deepEqual(result.errors, ['gap: {a: y, b: q}']);
});

test('UNIQUE table reports an overlap as an error', () => {
  const decision = table();
  decision.rules.push({ rule_id: 'R5', when: { a: 'x' }, then: { out: 'one' } });
  const result = evaluateTable(decision);
  assert.ok(result.errors.includes('UNIQUE overlap: {a: x, b: p} matches R1, R5'));
  assert.equal(result.overlaps.length, 2);
});

test('FIRST table resolves overlaps to the earlier rule and records shadowed cells', () => {
  const result = evaluateTable(w06());
  assert.deepEqual(result.errors, []);
  assert.equal(result.cells_total, 9);
  assert.equal(byId(result, 'R1').wins.length, 3);
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.overlaps, [
    { inputs: { volume_state: 'unmounted', error_kind: 'no_permission' }, rules: ['R1', 'R2'], winner: 'R1' },
    { inputs: { volume_state: 'unmounted', error_kind: 'other' }, rules: ['R1', 'R5'], winner: 'R1' },
  ]);
  assert.deepEqual(byId(result, 'R2').shadowed, [{ inputs: { volume_state: 'unmounted', error_kind: 'no_permission' }, winner: 'R1' }]);
  assert.equal(byId(result, 'R5').shadowed.length, 1);
  assert.equal(byId(result, 'R1').shadowed.length, 0);
});

test('FIRST table with overlaps requires a non-empty overlap_analysis', () => {
  const decision = w06();
  decision.overlap_analysis = [];
  assert.ok(evaluateTable(decision).errors.includes('FIRST overlaps exist but overlap_analysis is empty'));
  const wrongOrder = w06();
  wrongOrder.ordered_rules = false;
  assert.ok(evaluateTable(wrongOrder).errors.includes('ordered_rules must be true for FIRST'));
});

test('ANY table accepts overlapping rules with identical outputs and rejects differing ones', () => {
  const same = table({ hit_policy: 'ANY' });
  same.rules.push({ rule_id: 'R5', when: { a: 'x' }, then: { out: 'one' } });
  same.rules[1] = { rule_id: 'R2', when: { a: 'x', b: 'q' }, then: { out: 'one' } };
  const ok = evaluateTable(same);
  assert.deepEqual(ok.errors, []);
  assert.equal(byId(ok, 'R5').shadowed.length, 2);
  const differ = table({ hit_policy: 'ANY' });
  differ.rules.push({ rule_id: 'R5', when: { a: 'x', b: 'p' }, then: { out: 'two' } });
  assert.ok(evaluateTable(differ).errors.includes('ANY overlap with different outputs: {a: x, b: p} R1, R5'));
});

test('blank_means missing adds <missing> to the domain and an omitted cell matches only it', () => {
  const decision = table();
  decision.inputs[1].blank_means = 'missing';
  decision.rules = [
    { rule_id: 'R1', when: { a: 'x', b: 'p' }, then: { out: 'one' } },
    { rule_id: 'R2', when: { a: 'x', b: 'q' }, then: { out: 'two' } },
    { rule_id: 'R3', when: { a: 'x' }, then: { out: 'three' } },
    { rule_id: 'R4', when: { a: 'y', b: 'any' }, then: { out: 'four' } },
  ];
  const result = evaluateTable(decision);
  assert.deepEqual(result.errors, []);
  assert.equal(MISSING, '<missing>');
  assert.equal(result.cells_total, 6);
  assert.deepEqual(byId(result, 'R3').wins, [{ inputs: { a: 'x', b: MISSING }, expected: { out: 'three' } }]);
  assert.equal(byId(result, 'R4').wins.length, 3);
});

test('a literal outside allowed_values is an error for both when and then', () => {
  const decision = table();
  decision.rules[1] = { rule_id: 'R2', when: { a: 'foo', b: 'q' }, then: { out: 'bar' } };
  const result = evaluateTable(decision);
  assert.ok(result.errors.includes('rule R2 input a value foo is not in allowed_values'));
  assert.ok(result.errors.includes('rule R2 output out value bar is not in allowed_values'));
  assert.equal(result.cells_total, 0);
  assert.deepEqual(result.rules, []);
});

test('boolean inputs compare as strings', () => {
  const decision = table({
    inputs: [{ name: 'flag', type: 'boolean', allowed_values: [true, false], blank_means: 'any' }],
    rules: [
      { rule_id: 'R1', when: { flag: true }, then: { out: 'one' } },
      { rule_id: 'R2', when: { flag: false }, then: { out: 'two' } },
    ],
  });
  const result = evaluateTable(decision);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(byId(result, 'R1').wins, [{ inputs: { flag: 'true' }, expected: { out: 'one' } }]);
});

test('a list cell matches any listed value', () => {
  const decision = table({
    inputs: [{ name: 'tier', type: 'string', allowed_values: ['GOLD', 'SILVER', 'BRONZE'], blank_means: 'any' }],
    rules: [
      { rule_id: 'R1', when: { tier: ['GOLD', 'SILVER'] }, then: { out: 'one' } },
      { rule_id: 'R2', when: { tier: 'BRONZE' }, then: { out: 'two' } },
    ],
  });
  const result = evaluateTable(decision);
  assert.deepEqual(result.errors, []);
  assert.equal(byId(result, 'R1').wins.length, 2);
});

test('default_rule collects uncovered cells under DEFAULT and is an error when unreachable', () => {
  const partial = table({ default_rule: { then: { out: 'four' } } });
  partial.rules = partial.rules.slice(0, 3);
  const result = evaluateTable(partial);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.rules.at(-1).rule_id, 'DEFAULT');
  assert.deepEqual(result.rules.at(-1).wins, [{ inputs: { a: 'y', b: 'q' }, expected: { out: 'four' } }]);
  const unreachable = evaluateTable(table({ default_rule: { then: { out: 'four' } } }));
  assert.ok(unreachable.errors.includes('default_rule is unreachable'));
});

test('PRIORITY and COLLECT are rejected', () => {
  for (const policy of ['PRIORITY', 'COLLECT']) {
    const result = evaluateTable(table({ hit_policy: policy }));
    assert.ok(result.errors.includes(`hit_policy ${policy} is not supported by table-v1; use review-only`));
  }
});

test('tables above 10000 cells are rejected', () => {
  const values = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
  const inputs = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, type: 'string', allowed_values: values, blank_means: 'any' }));
  const result = evaluateTable(table({ inputs, rules: [{ rule_id: 'R1', when: {}, then: { out: 'one' } }] }));
  assert.equal(MAX_CELLS, 10000);
  assert.deepEqual(result.errors, ['cells_total 16807 exceeds 10000; split the table']);
  assert.deepEqual(result.rules, []);
});

test('vectors artifact is byte-identical across two renders with Korean values', () => {
  const decision = table({
    decision_id: '실패_원인',
    inputs: [{ name: '상태', type: 'string', allowed_values: ['마운트됨', '해제됨'], blank_means: 'any' }],
    outputs: [{ name: '원인', type: 'string', allowed_values: ['정상', '볼륨 없음'] }],
    rules: [
      { rule_id: 'R1', when: { 상태: '마운트됨' }, then: { 원인: '정상' } },
      { rule_id: 'R2', when: { 상태: '해제됨' }, then: { 원인: '볼륨 없음' } },
    ],
  });
  const render = () => YAML.stringify(
    vectorsArtifact({ decision, tablePath: 'specs/T1.decision.yaml', tableFingerprint: 'abc', taskId: 'T1' }),
    { lineWidth: 0 },
  );
  assert.equal(render(), render());
  assert.match(render(), /obligation_id: T1-실패_원인-R2/);
  assert.equal(obligationIdFor('T1', 'd', 'R1'), 'T1-d-R1');
  assert.throws(() => vectorsArtifact({ decision: table({ hit_policy: 'COLLECT' }), tablePath: 't', tableFingerprint: 'x', taskId: 'T1' }));
});

test('decision-vectors CLI refuses to overwrite a differing vectors file', () => {
  const directory = temporaryDirectory('decision');
  writeYaml(path.join(directory, 'W06.decision.yaml'), w06());
  const out = path.join(directory, 'W06.decision.vectors.yaml');
  const check = run(['check-decision', '--table', 'W06.decision.yaml'], directory);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /cells_total: 9/);
  const first = run(['decision-vectors', '--table', 'W06.decision.yaml', '--out', 'W06.decision.vectors.yaml'], directory);
  assert.equal(first.status, 0, first.stderr);
  const written = YAML.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(written.table, 'W06.decision.yaml');
  assert.equal(written.rules[0].obligation_id, 'W06-bookmark_failure_cause-R1');
  const again = run(['decision-vectors', '--table', 'W06.decision.yaml', '--out', 'W06.decision.vectors.yaml'], directory);
  assert.equal(again.status, 0, again.stderr);
  fs.appendFileSync(out, '# edited\n');
  const refused = run(['decision-vectors', '--table', 'W06.decision.yaml', '--out', 'W06.decision.vectors.yaml'], directory);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to overwrite vectors that differ: W06\.decision\.vectors\.yaml/);
  const bad = w06();
  bad.hit_policy = 'PRIORITY';
  writeYaml(path.join(directory, 'bad.yaml'), bad);
  const failed = run(['check-decision', '--table', 'bad.yaml'], directory);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^- hit_policy PRIORITY is not supported/m);
});

test('decision-vectors records an absolute --table as a path relative to the working directory', () => {
  const directory = temporaryDirectory('decision');
  writeYaml(path.join(directory, 'specs', 'W06.decision.yaml'), w06());
  const result = run(['decision-vectors', '--table', path.join(directory, 'specs', 'W06.decision.yaml'), '--out', 'specs/W06.decision.vectors.yaml'], directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(YAML.parse(fs.readFileSync(path.join(directory, 'specs', 'W06.decision.vectors.yaml'), 'utf8')).table, 'specs/W06.decision.yaml');
});
