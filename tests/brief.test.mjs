import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { readYaml, registerCleanup, run, temporaryFixture, writeYaml } from './helpers.mjs';

registerCleanup();

function handoffProject(name) {
  const project = temporaryFixture(name);
  const built = run(['build-handoff', '--manifest', 'run/author-manifest.yaml', '--report', 'run/critic-pass-1.yaml', '--out', 'run/tdd-handoff.yaml'], project);
  assert.equal(built.status, 0, built.stderr);
  return { project, handoffFile: path.join(project, 'run', 'tdd-handoff.yaml') };
}

function render(project, out = 'run/spec-brief.md') {
  const result = run(['render-brief', '--handoff', 'run/tdd-handoff.yaml', '--out', out], project);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(project, out), 'utf8');
}

function writePlan(project, ids, name = 'plan.md') {
  const file = path.join(project, name);
  fs.writeFileSync(file, `# Plan\n\n${ids.map((id) => `- test for ${id}`).join('\n')}\n`);
  return file;
}

test('render-brief includes every obligation id and every accepted specification path', () => {
  const { project, handoffFile } = handoffProject('dmn');
  const handoff = readYaml(handoffFile);
  const brief = render(project);
  for (const heading of ['## 1. 작업 항목', '## 2. 승인된 명세', '## 3. Test obligations', '## 4. 결정 벡터', '## 5. 결정', '## 6. Non-blocking notes', '## 7. 검증 계약']) {
    assert.ok(brief.includes(`\n${heading}\n`), heading);
  }
  assert.match(brief, /^# 명세 브리프 — 3 Determine membership discount\n/);
  assert.ok(handoff.test_obligations.length > 0);
  for (const obligation of handoff.test_obligations) assert.ok(brief.includes(obligation.obligation_id), obligation.obligation_id);
  for (const spec of handoff.accepted_specifications) assert.ok(brief.includes(spec.path), spec.path);
  assert.ok(brief.includes('모든 테스트의 이름 또는 태그에 그 테스트가 증명하는 obligation_id를 포함한다. /spec-cycle:verify 가 이 문자열을 찾는다.'));
  assert.ok(brief.endsWith('\n') && !brief.endsWith('\n\n'));
  assert.ok(!brief.includes(project));
});

test('render-brief is byte-identical on two renders with Korean scenario names', () => {
  const { project } = handoffProject('gherkin');
  fs.appendFileSync(path.join(project, 'run', 'specs', 'task-2.feature'), '\n  Scenario: 시작 시각 경계에서 입장한다\n    Given 등록된 학습자가 있다\n');
  const first = render(project, 'run/brief-a.md');
  const second = render(project, 'run/brief-b.md');
  assert.equal(first, second);
  assert.match(first, /```gherkin\n[\s\S]*시작 시각 경계에서 입장한다[\s\S]*```/);
  assert.match(first, /결정 기록:\n- input\/decisions\/0001-denial-reasons\.md|결정 기록:\n없음/);
});

test('render-brief renders a 1.0 handoff without a decision vectors section body', () => {
  const { project, handoffFile } = handoffProject('dmn');
  const handoff = readYaml(handoffFile);
  handoff.schema_version = '1.0';
  delete handoff.decision_vectors;
  writeYaml(handoffFile, handoff);
  const brief = render(project);
  assert.match(brief, /## 4\. 결정 벡터\n\n없음\n/);
});

test('render-brief renders table-v1 cells as a markdown table with the winning rule per cell', () => {
  const { project } = handoffProject('dmn');
  const brief = render(project);
  assert.ok(brief.includes('| rule_id | membership_tier | order_subtotal | discount_percent |'));
  assert.ok(brief.includes('| R1 | GOLD | >= 100000 | 20 |'));
  assert.ok(brief.includes('셀 맵'));
  assert.ok(brief.includes('| GOLD | >= 100000 | R1 |'));
  assert.ok(brief.includes('| NONE | < 100000 | R5 |'));
  assert.match(brief, /### membership-discount\n\n\| rule_id \| obligation_id \| inputs \| expected \|/);
  assert.ok(brief.includes('| R1 | 3-membership-discount-R1 | membership_tier=GOLD, order_subtotal=>= 100000 | discount_percent=20 |'));
});

test('write-brief refuses to overwrite a brief with different content', () => {
  const { project } = handoffProject('gherkin');
  render(project);
  const again = run(['render-brief', '--handoff', 'run/tdd-handoff.yaml', '--out', 'run/spec-brief.md'], project);
  assert.equal(again.status, 0, again.stderr);
  fs.appendFileSync(path.join(project, 'run', 'spec-brief.md'), 'edited\n');
  const refused = run(['render-brief', '--handoff', 'run/tdd-handoff.yaml', '--out', 'run/spec-brief.md'], project);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /brief already exists with different content: run\/spec-brief\.md/);
});

test('check-plan lists obligations absent from the plan and exits 1', () => {
  const { project, handoffFile } = handoffProject('dmn');
  const ids = readYaml(handoffFile).test_obligations.map((obligation) => obligation.obligation_id);
  const plan = writePlan(project, ids.slice(1));
  const result = run(['check-plan', '--plan', plan, '--handoff', 'run/tdd-handoff.yaml'], project);
  assert.equal(result.status, 1);
  const output = result.stdout;
  assert.match(output, new RegExp(`total: ${ids.length}`));
  assert.ok(output.includes(ids[0]));
  assert.ok(result.stderr.includes(`obligation ${ids[0]} is not assigned in the plan`));
});

test('check-plan does not accept a prefix match', () => {
  const { project } = handoffProject('dmn');
  const plan = path.join(project, 'plan.md');
  fs.writeFileSync(plan, '3-membership-discount-R10\n');
  const result = run(['check-plan', '--plan', plan, '--handoff', 'run/tdd-handoff.yaml'], project);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('obligation 3-membership-discount-R1 is not assigned in the plan'));
});

test('check-plan passes when every obligation appears', () => {
  const { project, handoffFile } = handoffProject('dmn');
  const ids = readYaml(handoffFile).test_obligations.map((obligation) => obligation.obligation_id);
  const plan = writePlan(project, ids);
  const result = run(['check-plan', '--plan', plan, '--handoff', 'run/tdd-handoff.yaml'], project);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(YAML.parse(result.stdout), { total: ids.length, missing: [] });
});
