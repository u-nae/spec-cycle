import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ValidationError, asArray, isObject, optional, readYaml, required } from './util.mjs';
import { loadConfig } from './config.mjs';
import { decisionRecordFiles, findProjectRoot, resolveArtifact } from './core.mjs';
import { evaluateTable } from './decision.mjs';
import { containsId } from './ids.mjs';

const VERIFICATION_CONTRACT = '모든 테스트의 이름 또는 태그에 그 테스트가 증명하는 obligation_id를 포함한다. /spec-cycle:verify 가 이 문자열을 찾는다.';

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers, rows) {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
}

function pairs(values) {
  return Object.entries(values ?? {}).map(([key, value]) => `${key}=${value}`).join(', ');
}

function ruleCell(value) {
  if (value === undefined || value === null || value === '') return '(blank)';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return String(value);
}

function renderDecisionTable(decision) {
  const lines = [];
  const inputs = asArray(decision?.inputs).map((input) => input?.name);
  const outputs = asArray(decision?.outputs).map((output) => output?.name);
  const rules = asArray(decision?.rules);
  lines.push(...table(
    ['rule_id', ...inputs, ...outputs],
    rules.map((rule) => [
      rule?.rule_id,
      ...inputs.map((name) => ruleCell(rule?.when?.[name])),
      ...outputs.map((name) => ruleCell(rule?.then?.[name])),
    ]),
  ));
  if (decision?.execution_format !== 'table-v1') return lines;

  lines.push('', '셀 맵', '');
  const evaluation = evaluateTable(decision);
  if (evaluation.errors.length > 0) {
    lines.push(`(계산 불가: ${evaluation.errors.join('; ')})`);
    return lines;
  }
  const order = (name, value) => {
    const allowed = asArray(asArray(decision.inputs).find((input) => input?.name === name)?.allowed_values).map(String);
    const index = allowed.indexOf(String(value));
    return index < 0 ? allowed.length : index;
  };
  const cells = evaluation.rules.flatMap((rule) => rule.wins.map((win) => ({ inputs: win.inputs, rule_id: rule.rule_id })));
  cells.sort((a, b) => {
    for (const name of inputs) {
      const difference = order(name, a.inputs[name]) - order(name, b.inputs[name]);
      if (difference !== 0) return difference;
    }
    return 0;
  });
  lines.push(...table([...inputs, 'rule_id'], cells.map((item) => [...inputs.map((name) => item.inputs[name]), item.rule_id])));
  return lines;
}

function renderSpecification(spec, projectRoot) {
  const lines = [`### ${spec.path}`, ''];
  const file = resolveArtifact(projectRoot, spec.path);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    lines.push(`(파일 없음: ${spec.path})`);
  } else if (spec.path.endsWith('.vectors.yaml')) {
    lines.push('벡터 파일 (§4에 반영)');
  } else if (spec.path.endsWith('.feature')) {
    lines.push('```gherkin', fs.readFileSync(file, 'utf8').replace(/\n+$/, ''), '```');
  } else if (spec.path.endsWith('.decision.yaml')) {
    lines.push(...renderDecisionTable(readYaml(file)));
  } else {
    lines.push('```', fs.readFileSync(file, 'utf8').replace(/\n+$/, ''), '```');
  }
  return lines;
}

function renderVectors(handoff) {
  const decisions = asArray(handoff.decision_vectors);
  if (String(handoff.schema_version) !== '1.1' || decisions.length === 0) return ['없음'];
  const lines = [];
  for (const [index, decision] of decisions.entries()) {
    if (index > 0) lines.push('');
    lines.push(`### ${decision.decision_id}`, '');
    const rows = asArray(decision.rules).flatMap((rule) => asArray(rule.wins).map((win) => [
      rule.rule_id, rule.obligation_id, pairs(win.inputs), pairs(win.expected),
    ]));
    lines.push(...table(['rule_id', 'obligation_id', 'inputs', 'expected'], rows));
  }
  return lines;
}

function renderDecisions(handoff, projectRoot) {
  const lines = [];
  let entries = [];
  if (handoff.decision_log) {
    const logFile = resolveArtifact(projectRoot, handoff.decision_log);
    if (fs.existsSync(logFile)) entries = asArray(readYaml(logFile)?.decisions);
  }
  if (entries.length === 0) lines.push('없음');
  else {
    lines.push(...table(
      ['question_id', 'question', 'answer', 'recommended_default', 'followed_recommendation'],
      entries.map((entry) => [entry.question_id, entry.question, entry.answer, entry.recommended_default, entry.followed_recommendation]),
    ));
  }

  let records = [];
  try {
    const config = loadConfig(projectRoot);
    records = decisionRecordFiles(projectRoot, config.decision_records)
      .filter((file) => fs.readFileSync(resolveArtifact(projectRoot, file), 'utf8').includes(String(handoff.run_id)));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }
  lines.push('', '결정 기록:');
  if (records.length === 0) lines.push('없음');
  else lines.push(...[...records].sort().map((file) => `- ${file}`));
  return lines;
}

function renderBrief({ handoffFile }) {
  const handoffPath = path.resolve(handoffFile);
  const handoff = readYaml(handoffPath);
  if (!isObject(handoff)) throw new ValidationError([`handoff is not a mapping: ${handoffFile}`]);
  const projectRoot = findProjectRoot(handoffPath, handoff.source?.work_items_artifact);
  const tasks = asArray(handoff.source_tasks);
  const first = tasks[0] ?? {};
  const ids = tasks.map((task) => String(task.task_id)).join(', ');

  const out = [];
  out.push(`# 명세 브리프 — ${tasks.length > 1 ? ids : first.task_id} ${first.title ?? ''}`.trimEnd(), '');
  out.push('## 1. 작업 항목', '');
  out.push(...table(
    ['task_id', 'title', 'route', 'acceptance_refs'],
    tasks.map((task) => [task.task_id, task.title, task.route, asArray(task.acceptance_refs).join(', ')]),
  ), '');
  out.push('기준 문서:');
  const baseline = asArray(handoff.source?.baseline);
  if (baseline.length === 0) out.push('없음');
  for (const doc of baseline) out.push(`- ${doc.path} (${String(doc.fingerprint ?? '').slice(0, 12)})`);
  out.push('', `run_id: ${handoff.run_id}`, '');

  out.push('## 2. 승인된 명세', '');
  for (const spec of asArray(handoff.accepted_specifications)) out.push(...renderSpecification(spec, projectRoot), '');

  out.push('## 3. Test obligations', '');
  out.push(...table(
    ['obligation_id', 'kind', 'description', 'acceptance_refs', 'source'],
    asArray(handoff.test_obligations).map((item) => [
      item.obligation_id, item.kind, item.description, asArray(item.acceptance_refs).join(', '), item.source,
    ]),
  ), '');

  out.push('## 4. 결정 벡터', '', ...renderVectors(handoff), '');
  out.push('## 5. 결정', '', ...renderDecisions(handoff, projectRoot), '');

  out.push('## 6. Non-blocking notes', '');
  const notes = asArray(handoff.non_blocking_notes);
  if (notes.length === 0) out.push('없음');
  for (const note of notes) out.push(`- ${note.finding_id} (${note.task_id}): ${String(note.note ?? '').replace(/\s*\n\s*/g, ' ').trim()}`);
  out.push('', '## 7. 검증 계약', '', VERIFICATION_CONTRACT);

  return `${out.join('\n')}\n`;
}

function writeBrief({ handoffFile, outFile }) {
  const content = renderBrief({ handoffFile });
  if (fs.existsSync(outFile)) {
    if (fs.readFileSync(outFile, 'utf8') === content) return { path: outFile, status: 'unchanged' };
    throw new Error(`brief already exists with different content: ${outFile}`);
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, content);
  return { path: outFile, status: 'created' };
}

function checkPlan({ planFile, handoffFile }) {
  const text = fs.readFileSync(planFile, 'utf8');
  const handoff = readYaml(handoffFile);
  const ids = asArray(handoff?.test_obligations).map((item) => String(item.obligation_id));
  if (ids.length === 0) throw new ValidationError(['handoff has no test obligations']);
  return { total: ids.length, missing: ids.filter((id) => !containsId(text, id)) };
}

function renderBriefCommand(args) {
  const handoffFile = path.resolve(required(args, 'handoff'));
  const outArg = required(args, 'out');
  const result = writeBrief({ handoffFile, outFile: outArg });
  console.log(YAML.stringify(result, { lineWidth: 0 }).trimEnd());
}

function checkPlanCommand(args) {
  const result = checkPlan({
    planFile: path.resolve(required(args, 'plan')),
    handoffFile: path.resolve(required(args, 'handoff')),
  });
  process.stdout.write(YAML.stringify(result, { lineWidth: 0 }));
  if (result.missing.length > 0) {
    throw new ValidationError(result.missing.map((id) => `obligation ${id} is not assigned in the plan`));
  }
}

export { renderBrief, writeBrief, checkPlan, renderBriefCommand, checkPlanCommand };
