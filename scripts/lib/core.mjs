import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  ValidationError, parseArgs, required, optional, readYaml, writeYaml, sha256File, isBlank, asArray, isObject,
  portablePath, assertPortable,
} from './util.mjs';
import { isDeepStrictEqual } from 'node:util';
import { evaluateTable, vectorsArtifact, obligationIdFor } from './decision.mjs';
import { importTaskMaster } from './intake-taskmaster.mjs';
import { loadConfig, initCommand, DEFAULT_CONFIG, DEFAULT_RUN_ROOT } from './config.mjs';

const ROUTES = new Set(['PASS', 'GHERKIN', 'DMN', 'BOTH']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const AUTHOR_STATUSES = new Set(['READY_FOR_CRITIC', 'NEEDS_HUMAN']);
const VERDICTS = new Set(['READY', 'REVISE', 'NEEDS_HUMAN', 'BLOCKED_AT_LIMIT']);
const SEVERITIES = new Set(['critical', 'major', 'minor', 'note']);
const ITEM_STATUSES = new Set(['pending', 'in-progress', 'done', 'deferred']);
const PRIORITIES = new Set(['high', 'medium', 'low']);
const CATEGORIES = new Set([
  'ambiguity',
  'contradiction',
  'missing-case',
  'unverifiable',
  'over-specification',
  'traceability',
  'syntax',
  'policy-gap',
  'invariant-gap',
]);
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function authorReviewFingerprint(manifestFile) {
  const manifest = readYaml(manifestFile);
  const projectRoot = findProjectRoot(manifestFile, manifest?.source?.work_items_artifact);
  const hash = crypto.createHash('sha256');
  hash.update('author-manifest\0');
  hash.update(fs.readFileSync(manifestFile));
  const specFiles = asArray(manifest?.tasks)
    .flatMap((task) => asArray(task?.spec_files))
    .sort();
  for (const specPath of specFiles) {
    const fullPath = resolveArtifact(projectRoot, specPath);
    hash.update(`\0spec\0${specPath}\0`);
    if (fs.existsSync(fullPath)) hash.update(fs.readFileSync(fullPath));
    else hash.update('<missing>');
  }
  return hash.digest('hex');
}

function findProjectRoot(artifactFile, sourcePath) {
  if (!sourcePath || path.isAbsolute(sourcePath)) return path.dirname(artifactFile);
  let current = path.dirname(path.resolve(artifactFile));
  const filesystemRoot = path.parse(current).root;
  while (true) {
    if (fs.existsSync(path.join(current, sourcePath))) return current;
    if (current === filesystemRoot) break;
    current = path.dirname(current);
  }
  return path.dirname(path.resolve(artifactFile));
}

function resolveArtifact(projectRoot, artifactPath) {
  return path.resolve(projectRoot, artifactPath);
}

// ---------------------------------------------------------------------------
// Sources: baseline documents, decision records, and the work-item list.
// ---------------------------------------------------------------------------

function decisionRecordFiles(projectRoot, directory) {
  if (!directory) return [];
  const full = path.join(projectRoot, directory);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return [];
  return walkFiles(full, (file) => file.endsWith('.md'))
    .map((file) => portablePath(file, projectRoot))
    .sort();
}

// A decision record directory is fingerprinted as a set, so adding, removing, or editing any record
// invalidates a run that was authored against the previous set.
function decisionRecordsFingerprint(projectRoot, directory) {
  const hash = crypto.createHash('sha256');
  hash.update('decision-records\0');
  for (const file of decisionRecordFiles(projectRoot, directory)) {
    hash.update(`${file}\0${sha256File(path.join(projectRoot, file))}\0`);
  }
  return hash.digest('hex');
}

function sourceSnapshot(projectRoot, config) {
  return {
    baseline: config.baseline.map((doc) => ({ path: doc, fingerprint: sha256File(path.join(projectRoot, doc)) })),
    decision_records: {
      path: config.decision_records,
      fingerprint: decisionRecordsFingerprint(projectRoot, config.decision_records),
    },
    work_items_artifact: config.work_items,
    work_items_fingerprint: sha256File(path.join(projectRoot, config.work_items)),
  };
}

function readWorkItems(file) {
  const data = readYaml(file);
  if (data?.schema_version !== '1.0') throw new ValidationError([`${file}: schema_version must be 1.0`]);
  if (!Array.isArray(data?.items)) throw new ValidationError([`${file}: items must be an array`]);
  return data.items;
}

function stringList(value, label, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    errors.push(`${label} must be an array of non-empty strings`);
    return [];
  }
  return value;
}

function normalizeItem(item, warnings, errors, parent = null) {
  const where = parent ? `item ${parent.id} subtask` : 'top-level item';
  if (isBlank(item?.id)) {
    errors.push(`Work item is missing a required id at ${where}`);
    return null;
  }
  const localId = String(item.id);
  if (!ITEM_ID.test(localId)) {
    errors.push(`Work item id ${localId} must match ${ITEM_ID} (dots are reserved for subtasks)`);
    return null;
  }
  const taskId = parent ? `${parent.id}.${localId}` : localId;
  if (isBlank(item.title)) errors.push(`Work item ${taskId} requires a title`);
  const status = item.status ?? 'pending';
  if (!ITEM_STATUSES.has(status)) {
    warnings.push({ task_id: taskId, field: 'status', observed_value: status, message: 'Unknown status preserved for author review' });
  }
  if (!isBlank(item.priority) && !PRIORITIES.has(item.priority)) {
    warnings.push({ task_id: taskId, field: 'priority', observed_value: item.priority, message: 'Unknown priority preserved for author review' });
  }
  const dependencies = stringList(item.dependencies?.map?.(String), `${taskId}.dependencies`, errors)
    .map((dependency) => (parent && !dependency.includes('.') ? `${parent.id}.${dependency}` : dependency));
  return {
    task_id: taskId,
    parent_task_id: parent ? String(parent.id) : null,
    title: item.title ?? '',
    description: item.description ?? '',
    details: item.details ?? '',
    test_strategy: item.test_strategy ?? '',
    status,
    priority: item.priority ?? null,
    dependencies,
    source_refs: stringList(item.source_refs, `${taskId}.source_refs`, errors),
    acceptance_refs: stringList(item.acceptance_refs, `${taskId}.acceptance_refs`, errors),
    source_locator: parent
      ? `work-items[id=${parent.id}].subtasks[id=${localId}]`
      : `work-items[id=${localId}]`,
  };
}

function flattenWorkItems(items, source) {
  if (items.length === 0) {
    throw new ValidationError([
      `Work item list is empty: ${source}`,
      'Derive work items from the baseline first (work-items skill).',
    ]);
  }
  const warnings = [];
  const errors = [];
  const flattened = [];
  for (const item of items) {
    const normalized = normalizeItem(item, warnings, errors);
    if (!normalized) continue;
    flattened.push(normalized);
    for (const subtask of asArray(item.subtasks)) {
      const child = normalizeItem(subtask, warnings, errors, item);
      if (child) flattened.push(child);
    }
  }
  const ids = flattened.map((task) => task.task_id);
  if (new Set(ids).size !== ids.length) errors.push('Work item list contains duplicate identifiers');
  if (errors.length) throw new ValidationError(errors);
  return { tasks: flattened, warnings };
}

function selectTasks(tasks, requestedId) {
  if (!requestedId) return tasks;
  return tasks.filter((task) => task.task_id === requestedId || task.task_id.startsWith(`${requestedId}.`));
}

function normalizeCommand(args) {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot, optional(args, 'config'));
  const outputFile = path.resolve(required(args, 'out'));
  if (fs.existsSync(outputFile)) throw new Error(`Refusing to overwrite existing normalized artifact: ${outputFile}`);
  const { tasks, warnings } = flattenWorkItems(readWorkItems(path.join(projectRoot, config.work_items)), config.work_items);
  const filter = optional(args, 'task');
  const selected = selectTasks(tasks, filter);
  if (selected.length === 0) throw new Error(`No work items matched ${filter}`);
  const artifact = {
    schema_version: '1.0',
    source: sourceSnapshot(projectRoot, config),
    normalization_warnings: warnings.filter((warning) => selected.some((task) => task.task_id === warning.task_id)),
    tasks: selected,
  };
  writeYaml(outputFile, artifact);
  console.log(outputFile);
}

function gitStatusFor(projectRoot, relativePath) {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot, encoding: 'utf8' });
  if (inside.status !== 0) return { inside_work_tree: false, ignored: null };
  const ignored = spawnSync('git', ['check-ignore', '-q', '--', relativePath], { cwd: projectRoot, encoding: 'utf8' });
  return { inside_work_tree: true, ignored: ignored.status === 0 };
}

function sourceRefFile(ref) {
  return ref.split('#')[0];
}

function resolveInputsCommand(args) {
  const projectRoot = path.resolve(optional(args, 'project') ?? process.cwd());
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root not found: ${projectRoot}`);
  const configArg = optional(args, 'config');
  const config = loadConfig(projectRoot, configArg);
  const { tasks } = flattenWorkItems(readWorkItems(path.join(projectRoot, config.work_items)), config.work_items);
  const taskFilter = optional(args, 'task');
  const selected = selectTasks(tasks, taskFilter);
  if (selected.length === 0) throw new Error(`No work items matched ${taskFilter}`);

  // `warnings` need a human decision before authoring; `notices` are defects the agent fixes itself.
  const warnings = [];
  const notices = [];
  // The gate belongs before implementation. Specifying work that already started produces
  // after-the-fact documentation, not a gate, so the human must confirm it.
  const started = selected.filter((task) => task.status === 'done' || task.status === 'in-progress');
  if (started.length > 0) {
    warnings.push(
      `${started.map((task) => `${task.task_id} (${task.status})`).join(', ')} `
      + 'already left the pending state. Specifying implemented work yields after-the-fact documentation. '
      + 'Confirm with the human before authoring these.',
    );
  }
  const decisionFiles = new Set(decisionRecordFiles(projectRoot, config.decision_records));
  const knownSources = new Set([...config.baseline, ...decisionFiles]);
  for (const task of selected) {
    if (task.source_refs.length === 0) {
      notices.push(`${task.task_id} has no source_refs; add baseline locators to the work item before authoring.`);
    }
    for (const ref of task.source_refs) {
      if (!knownSources.has(sourceRefFile(ref))) {
        notices.push(`${task.task_id} source_ref ${ref} does not point to a baseline document or decision record.`);
      }
    }
  }

  const source = sourceSnapshot(projectRoot, config);
  const fingerprint = crypto.createHash('sha256');
  fingerprint.update(JSON.stringify(source));
  fingerprint.update(`\0${taskFilter ?? 'all'}`);
  const runId = `${taskFilter ? `t-${taskFilter.replaceAll('.', '-').toLowerCase()}` : 'all'}-${fingerprint.digest('hex').slice(0, 8)}`;
  const runDir = `${config.run_root}/${runId}`;

  const resolution = {
    schema_version: '1.0',
    project_root: projectRoot,
    config: config.path,
    source,
    decision_record_files: [...decisionFiles],
    task_filter: taskFilter,
    selected_task_ids: selected.map((task) => task.task_id),
    warnings,
    notices,
    run_id: runId,
    run_dir: runDir,
    run_dir_status: fs.existsSync(path.join(projectRoot, runDir)) ? 'exists' : 'absent',
    git: gitStatusFor(projectRoot, runDir),
    normalize_command: [
      'node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs normalize',
      configArg ? `--config ${config.path}` : null,
      `--out ${runDir}/normalized-tasks.yaml`,
      taskFilter ? `--task ${taskFilter}` : null,
    ].filter(Boolean).join(' '),
  };
  if (resolution.git.inside_work_tree && resolution.git.ignored === false) {
    resolution.gitignore_hint = [
      '# spec gate intermediate artifacts (keep tdd-handoff.yaml, accepted specs, and decision logs)',
      `${config.run_root}/*/normalized-tasks.yaml`,
      `${config.run_root}/*/author-manifest-*.yaml`,
      `${config.run_root}/*/critic-pass-*.yaml`,
    ].join('\n');
  }
  console.log(YAML.stringify(resolution, { lineWidth: 0 }));
  return resolution;
}

// ---------------------------------------------------------------------------
// Specification and manifest validation
// ---------------------------------------------------------------------------

async function parseGherkin(file) {
  const [{ Parser, AstBuilder, GherkinClassicTokenMatcher }, { IdGenerator }] = await Promise.all([
    import('@cucumber/gherkin'),
    import('@cucumber/messages'),
  ]);
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());
  return parser.parse(fs.readFileSync(file, 'utf8'));
}

// The table path is the table's own spec_files entry, never the value in the vectors file under test.
function expectedVectors(decision, tablePath, file, taskId) {
  if (evaluateTable(decision).errors.length > 0) return null;
  const artifact = vectorsArtifact({ decision, tablePath, tableFingerprint: sha256File(file), taskId });
  return YAML.parse(YAML.stringify(artifact));
}

function validateDecision(file, expectedTaskId, context = null) {
  const errors = [];
  let decision;
  try {
    decision = readYaml(file);
  } catch (error) {
    return [`${file}: invalid YAML: ${error.message}`];
  }
  if (decision?.schema_version !== '1.0') errors.push(`${file}: schema_version must be 1.0`);
  if (String(decision?.task_id) !== String(expectedTaskId)) errors.push(`${file}: task_id must match ${expectedTaskId}`);
  const tableV1 = decision?.execution_format === 'table-v1';
  if (decision?.execution_format !== 'review-only' && !tableV1) errors.push(`${file}: execution_format must be review-only or table-v1`);
  if (typeof decision?.decision_id !== 'string' || !decision.decision_id) errors.push(`${file}: decision_id is required`);
  if (typeof decision?.hit_policy !== 'string' || !decision.hit_policy) errors.push(`${file}: hit_policy is required`);
  if (typeof decision?.ordered_rules !== 'boolean') errors.push(`${file}: ordered_rules must be boolean`);
  const inputs = asArray(decision?.inputs);
  const outputs = asArray(decision?.outputs);
  const rules = asArray(decision?.rules);
  if (inputs.length === 0) errors.push(`${file}: at least one input is required`);
  if (outputs.length === 0) errors.push(`${file}: at least one output is required`);
  if (rules.length === 0) errors.push(`${file}: at least one rule is required`);
  const inputNames = new Set(inputs.map((input) => input.name));
  const outputNames = new Set(outputs.map((output) => output.name));
  for (const input of inputs) {
    if (!input.name || !input.type) errors.push(`${file}: every input requires name and type`);
    if (!Array.isArray(input.allowed_values)) errors.push(`${file}: input ${input.name} requires allowed_values`);
    if (!['any', 'missing'].includes(input.blank_means)) errors.push(`${file}: input ${input.name} must declare blank_means as any or missing`);
  }
  for (const output of outputs) {
    if (!output.name || !output.type) errors.push(`${file}: every output requires name and type`);
    if (!Array.isArray(output.allowed_values)) errors.push(`${file}: output ${output.name} requires allowed_values`);
  }
  const ruleIds = new Set();
  for (const rule of rules) {
    if (!rule.rule_id || ruleIds.has(rule.rule_id)) errors.push(`${file}: rule IDs must be unique and non-empty`);
    ruleIds.add(rule.rule_id);
    for (const name of Object.keys(rule.when ?? {})) {
      if (!inputNames.has(name)) errors.push(`${file}: rule ${rule.rule_id} uses unknown input ${name}`);
    }
    for (const name of Object.keys(rule.then ?? {})) {
      if (!outputNames.has(name)) errors.push(`${file}: rule ${rule.rule_id} uses unknown output ${name}`);
    }
  }
  if (!Array.isArray(decision?.gap_analysis)) errors.push(`${file}: gap_analysis must be an array`);
  if (!Array.isArray(decision?.overlap_analysis)) errors.push(`${file}: overlap_analysis must be an array`);
  if (!Array.isArray(decision?.source_locators) || decision.source_locators.length === 0) errors.push(`${file}: source_locators must be non-empty`);
  if (tableV1) {
    for (const error of evaluateTable(decision).errors) errors.push(`${file}: ${error}`);
    if (context) {
      const relative = path.relative(context.projectRoot, file).split(path.sep).join('/');
      const vectorsPath = relative.replace(/\.yaml$/, '.vectors.yaml');
      if (!asArray(context.specFiles).includes(vectorsPath)) {
        errors.push(`${file}: table-v1 requires its vectors file ${vectorsPath} in spec_files`);
      } else {
        const vectorsFile = resolveArtifact(context.projectRoot, vectorsPath);
        if (fs.existsSync(vectorsFile)) {
          let vectors = null;
          try {
            vectors = readYaml(vectorsFile);
          } catch (error) {
            errors.push(`${vectorsFile}: invalid YAML: ${error.message}`);
            vectors = undefined;
          }
          const tableErrors = [];
          if (vectors !== undefined && vectors !== null && assertPortable(vectors.table, `${vectorsFile}: table`, tableErrors)
            && vectors.table !== relative) {
            tableErrors.push(`${vectorsFile}: table must be ${relative}, the table's spec_files entry`);
          }
          errors.push(...tableErrors);
          if (vectors !== undefined && tableErrors.length === 0
            && !isDeepStrictEqual(vectors, expectedVectors(decision, relative, file, context.taskId ?? expectedTaskId))) {
            errors.push(`${vectorsFile}: vectors file is stale: regenerate with decision-vectors`);
          }
        }
      }
    }
  }
  return errors;
}

// Every question carries the agent's own judgement: options with their consequences, a recommended
// option, and the reason for recommending it. A question without a proposal pushes the whole
// judgement onto the human, which this gate does not allow.
function validateQuestion(question, label, taskId, errors) {
  for (const field of ['question_id', 'task_id', 'ambiguity', 'evidence', 'question']) {
    if (isBlank(question?.[field])) errors.push(`${label}.${field} is required`);
  }
  if (String(question?.task_id) !== String(taskId)) errors.push(`${label}.task_id must match ${taskId}`);
  if (typeof question?.blocking !== 'boolean') errors.push(`${label}.blocking must be boolean`);
  const options = asArray(question?.options);
  if (!Array.isArray(question?.options) || options.length < 2) errors.push(`${label}.options must list at least two choices`);
  const optionIds = new Set();
  for (const [index, option] of options.entries()) {
    if (!isObject(option)) {
      errors.push(`${label}.options[${index}] must be an object with id, label, and detail`);
      continue;
    }
    for (const field of ['id', 'label', 'detail']) {
      if (isBlank(option[field])) errors.push(`${label}.options[${index}].${field} is required`);
    }
    if (optionIds.has(String(option.id))) errors.push(`${label}.options ids must be unique`);
    optionIds.add(String(option.id));
  }
  if (isBlank(question?.recommended_default)) {
    errors.push(`${label}.recommended_default is required: propose the agent's preferred option`);
  } else if (!optionIds.has(String(question.recommended_default))) {
    errors.push(`${label}.recommended_default must name one of the option ids`);
  }
  if (isBlank(question?.recommendation_rationale)) errors.push(`${label}.recommendation_rationale is required`);
}

function validateObligation(obligation, label, taskId, errors) {
  for (const field of ['obligation_id', 'task_id', 'kind', 'description', 'source']) {
    if (isBlank(obligation?.[field])) errors.push(`${label}.${field} is required`);
  }
  if (String(obligation?.task_id) !== String(taskId)) errors.push(`${label}.task_id must match ${taskId}`);
  if (obligation?.acceptance_refs !== undefined && !Array.isArray(obligation.acceptance_refs)) {
    errors.push(`${label}.acceptance_refs must be an array when present`);
  }
}

function validateSource(manifestSource, projectRoot, errors) {
  const baseline = asArray(manifestSource?.baseline);
  if (baseline.length === 0) errors.push('source.baseline must list at least one document');
  for (const [index, doc] of baseline.entries()) {
    if (!assertPortable(doc?.path, `source.baseline[${index}].path`, errors)) continue;
    if (!isSha256(doc?.fingerprint)) errors.push(`source.baseline[${index}].fingerprint must be SHA-256`);
    const full = resolveArtifact(projectRoot, doc.path);
    if (!fs.existsSync(full)) errors.push(`source.baseline document does not exist: ${doc.path}`);
    else if (sha256File(full) !== doc.fingerprint) errors.push(`source.baseline fingerprint is stale: ${doc.path}`);
  }
  const records = manifestSource?.decision_records;
  if (!isObject(records)) {
    errors.push('source.decision_records is required');
  } else {
    if (!isBlank(records.path)) assertPortable(records.path, 'source.decision_records.path', errors);
    if (!isSha256(records.fingerprint)) errors.push('source.decision_records.fingerprint must be SHA-256');
    else if (decisionRecordsFingerprint(projectRoot, records.path) !== records.fingerprint) {
      errors.push('source.decision_records fingerprint is stale');
    }
  }
  if (assertPortable(manifestSource?.work_items_artifact, 'source.work_items_artifact', errors)) {
    const full = resolveArtifact(projectRoot, manifestSource.work_items_artifact);
    if (!isSha256(manifestSource?.work_items_fingerprint)) errors.push('source.work_items_fingerprint must be SHA-256');
    if (!fs.existsSync(full)) errors.push('source.work_items_artifact does not exist');
    else if (sha256File(full) !== manifestSource.work_items_fingerprint) errors.push('source.work_items_fingerprint is stale');
  }
}

function sameSource(left, right) {
  const strip = ({ normalized_artifact: _ignored, ...rest } = {}) => rest;
  return JSON.stringify(strip(left)) === JSON.stringify(strip(right));
}

/// A plain (unquoted) value followed on the same line by " #" loses everything after it: YAML reads the
/// rest as a comment. Authors write prose such as "restored(from #2)" in descriptions, so report it
/// instead of letting the cut text reach the handoff and the brief.
function inlineCommentCuts(text) {
  const lines = new YAML.LineCounter();
  const doc = YAML.parseDocument(text, { lineCounter: lines });
  const cuts = [];
  YAML.visit(doc, {
    Scalar(_, node) {
      if (node.type !== 'PLAIN' || !node.comment || !node.range) return;
      const { line } = lines.linePos(node.range[0]);
      cuts.push(`line ${line}: the value "${node.source}" is cut by " #${node.comment}", which YAML reads as a comment; quote the value`);
    },
  });
  return cuts;
}

async function validateAuthorFile(manifestFile) {
  const errors = [];
  let manifest;
  try {
    manifest = readYaml(manifestFile);
  } catch (error) {
    throw new ValidationError([`Invalid author YAML: ${error.message}`]);
  }
  errors.push(...inlineCommentCuts(fs.readFileSync(manifestFile, 'utf8')).map((cut) => `${manifestFile}: ${cut}`));
  if (manifest?.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  if (!manifest?.run_id) errors.push('run_id is required');
  if (!Number.isInteger(manifest?.revision_count) || manifest.revision_count < 0) errors.push('revision_count must be a non-negative integer');
  if (!Number.isInteger(manifest?.max_revisions) || manifest.max_revisions < 0) errors.push('max_revisions must be a non-negative integer');
  if (manifest?.revision_count > manifest?.max_revisions) errors.push('revision_count cannot exceed max_revisions');
  if (Number.isNaN(Date.parse(manifest?.generated_at))) errors.push('generated_at must be ISO-8601');
  const projectRoot = findProjectRoot(manifestFile, manifest?.source?.work_items_artifact);
  validateSource(manifest?.source, projectRoot, errors);
  const tasks = asArray(manifest?.tasks);
  if (tasks.length === 0) errors.push('tasks must be non-empty');
  let normalizedTasks = null;
  if (!assertPortable(manifest?.source?.normalized_artifact, 'source.normalized_artifact', errors)) {
    // reported above
  } else if (!fs.existsSync(resolveArtifact(projectRoot, manifest.source.normalized_artifact))) {
    errors.push('source.normalized_artifact does not exist');
  } else {
    try {
      const normalized = readYaml(resolveArtifact(projectRoot, manifest.source.normalized_artifact));
      if (normalized?.schema_version !== '1.0') errors.push('normalized artifact schema_version must be 1.0');
      if (!sameSource(normalized?.source, manifest?.source)) errors.push('normalized artifact source does not match the manifest source');
      normalizedTasks = new Map(asArray(normalized?.tasks).map((task) => [String(task.task_id), task]));
    } catch (error) {
      errors.push(`source.normalized_artifact is invalid YAML: ${error.message}`);
    }
  }
  const seenTaskIds = new Set();
  for (const [index, task] of tasks.entries()) {
    const label = `tasks[${index}]`;
    const taskId = String(task?.task_id ?? '');
    if (!taskId || seenTaskIds.has(taskId)) errors.push(`${label}.task_id must be unique and non-empty`);
    seenTaskIds.add(taskId);
    const normalizedTask = normalizedTasks?.get(taskId);
    if (normalizedTasks && !normalizedTask) errors.push(`${label}.task_id is absent from normalized input`);
    if (!task?.title || !task?.source_locator) errors.push(`${label} requires title and source_locator`);
    if (!ROUTES.has(task?.route)) errors.push(`${label}.route is invalid`);
    if (!CONFIDENCE.has(task?.route_confidence)) errors.push(`${label}.route_confidence is invalid`);
    if (!Array.isArray(task?.route_reasons) || task.route_reasons.length === 0) errors.push(`${label}.route_reasons must be non-empty`);
    for (const field of ['acceptance_refs', 'risk_signals', 'assumptions', 'spec_files', 'test_obligations', 'questions']) {
      if (!Array.isArray(task?.[field])) errors.push(`${label}.${field} must be an array`);
    }
    if (normalizedTask && JSON.stringify(asArray(task?.acceptance_refs)) !== JSON.stringify(asArray(normalizedTask.acceptance_refs))) {
      errors.push(`${label}.acceptance_refs must equal the work item's acceptance_refs`);
    }
    if (!AUTHOR_STATUSES.has(task?.author_status)) errors.push(`${label}.author_status is invalid`);
    const specFiles = asArray(task?.spec_files);
    const extensions = new Set(specFiles.map((file) => path.extname(file)));
    if (task?.route === 'PASS' && specFiles.length > 0) errors.push(`${label}: PASS must not create formal specification files`);
    if (task?.route === 'GHERKIN' && !extensions.has('.feature')) errors.push(`${label}: GHERKIN requires a .feature file`);
    if (task?.route === 'DMN' && !specFiles.some((file) => file.endsWith('.decision.yaml') && !file.endsWith('.vectors.yaml'))) errors.push(`${label}: DMN requires a .decision.yaml file`);
    if (task?.route === 'BOTH' && (!extensions.has('.feature') || !specFiles.some((file) => file.endsWith('.decision.yaml') && !file.endsWith('.vectors.yaml')))) {
      errors.push(`${label}: BOTH requires .feature and .decision.yaml files`);
    }
    for (const [questionIndex, question] of asArray(task?.questions).entries()) {
      validateQuestion(question, `${label}.questions[${questionIndex}]`, taskId, errors);
    }
    const unansweredBlocking = asArray(task?.questions).some((question) => question.blocking && isBlank(question.answer));
    if (unansweredBlocking && task?.author_status !== 'NEEDS_HUMAN') errors.push(`${label}: unanswered blocking question requires NEEDS_HUMAN`);
    if (!unansweredBlocking && task?.author_status === 'NEEDS_HUMAN') errors.push(`${label}: NEEDS_HUMAN requires an unanswered blocking question`);
    const obligations = asArray(task?.test_obligations);
    if (obligations.length === 0) errors.push(`${label}.test_obligations must be non-empty, including PASS tasks`);
    for (const [obligationIndex, obligation] of obligations.entries()) {
      validateObligation(obligation, `${label}.test_obligations[${obligationIndex}]`, taskId, errors);
      if (typeof obligation?.source === 'string' && path.isAbsolute(obligation.source.split('#')[0])) {
        errors.push(`${label}.test_obligations[${obligationIndex}].source must be repository-relative or a source locator`);
      }
    }
    // Acceptance criteria named by the work item must each be carried by at least one obligation,
    // otherwise TDD can finish while an acceptance check silently has no test.
    const covered = new Set(obligations.flatMap((obligation) => asArray(obligation?.acceptance_refs)));
    for (const ref of asArray(task?.acceptance_refs)) {
      if (!covered.has(ref)) errors.push(`${label}: acceptance ${ref} is not covered by any test obligation`);
    }
    for (const ref of covered) {
      if (!asArray(task?.acceptance_refs).includes(ref)) errors.push(`${label}: obligation cites acceptance ${ref} that the work item does not list`);
    }
    for (const [specIndex, specPath] of specFiles.entries()) {
      if (!assertPortable(specPath, `${label}.spec_files[${specIndex}]`, errors)) continue;
      const fullPath = resolveArtifact(projectRoot, specPath);
      if (!fs.existsSync(fullPath)) {
        errors.push(`${label}: specification not found: ${specPath}`);
        continue;
      }
      if (specPath.endsWith('.feature')) {
        try {
          const document = await parseGherkin(fullPath);
          const featureName = document?.feature?.name ?? '';
          const source = fs.readFileSync(fullPath, 'utf8');
          if (!featureName.includes(taskId) && !source.includes(`@task-${taskId.replaceAll('.', '-')}`)) {
            errors.push(`${label}: Gherkin must trace task ${taskId} in Feature name or tag`);
          }
        } catch (error) {
          errors.push(`${label}: invalid Gherkin ${specPath}: ${error.message}`);
        }
      }
      if (specPath.endsWith('.vectors.yaml')) {
        const tablePath = specPath.replace(/\.vectors\.yaml$/, '.yaml');
        const tableFile = resolveArtifact(projectRoot, tablePath);
        let sibling = null;
        try {
          sibling = fs.existsSync(tableFile) ? readYaml(tableFile) : null;
        } catch {
          sibling = null;
        }
        if (sibling?.execution_format !== 'table-v1') errors.push(`${fullPath}: vectors file listed but ${tablePath} is not table-v1`);
      } else if (specPath.endsWith('.decision.yaml')) {
        errors.push(...validateDecision(fullPath, taskId, { projectRoot, specFiles }));
        let decision = null;
        try {
          decision = readYaml(fullPath);
        } catch {
          decision = null;
        }
        if (decision?.execution_format === 'table-v1') {
          for (const rule of evaluateTable(decision).rules ?? []) {
            const wanted = `${specPath}#${rule.rule_id}`;
            const match = obligations.find((obligation) => obligation?.kind === 'decision-rule' && obligation?.source === wanted);
            const expectedId = obligationIdFor(taskId, decision.decision_id, rule.rule_id);
            if (!match) errors.push(`${label}: rule ${rule.rule_id} of ${decision.decision_id} has no decision-rule obligation`);
            else if (match.obligation_id !== expectedId) errors.push(`${label}: rule ${rule.rule_id} of ${decision.decision_id} must use obligation_id ${expectedId}`);
          }
        }
      }
    }
    if (task?.route === 'BOTH') {
      const featurePath = specFiles.find((file) => file.endsWith('.feature'));
      const decisionPath = specFiles.find((file) => file.endsWith('.decision.yaml') && !file.endsWith('.vectors.yaml'));
      if (featurePath && decisionPath) {
        const featureSource = fs.existsSync(resolveArtifact(projectRoot, featurePath))
          ? fs.readFileSync(resolveArtifact(projectRoot, featurePath), 'utf8')
          : '';
        const decision = fs.existsSync(resolveArtifact(projectRoot, decisionPath))
          ? readYaml(resolveArtifact(projectRoot, decisionPath))
          : null;
        const vocabulary = [
          decision?.decision_id,
          ...asArray(decision?.inputs).map((input) => input.name),
          ...asArray(decision?.outputs).map((output) => output.name),
        ].filter(Boolean);
        for (const term of vocabulary) {
          if (!featureSource.includes(term)) errors.push(`${label}: BOTH vocabulary ${term} is absent from the Gherkin artifact`);
        }
      }
    }
  }
  if (errors.length) throw new ValidationError(errors);
  return { manifest, projectRoot };
}

function validateDecisionLogFile(decisionFile, manifestFile) {
  const errors = [];
  const decisions = readYaml(decisionFile);
  const manifest = readYaml(manifestFile);
  if (decisions?.schema_version !== '1.0') errors.push('decision log schema_version must be 1.0');
  if (decisions?.run_id !== manifest?.run_id) errors.push('decision log run_id must match the author manifest');
  const questions = new Map();
  for (const task of asArray(manifest?.tasks)) {
    for (const question of asArray(task?.questions)) questions.set(question.question_id, question);
  }
  const seen = new Set();
  for (const [index, decision] of asArray(decisions?.decisions).entries()) {
    const label = `decisions[${index}]`;
    if (!decision?.question_id || seen.has(decision.question_id)) errors.push(`${label}.question_id must be unique and non-empty`);
    seen.add(decision?.question_id);
    const original = questions.get(decision?.question_id);
    if (!original) errors.push(`${label}.question_id does not exist in the manifest`);
    if (original && String(decision?.task_id) !== String(original.task_id)) errors.push(`${label}.task_id must match the original question`);
    if (original && decision?.question !== original.question) errors.push(`${label}.question must preserve the original question text`);
    if (original && String(decision?.recommended_default) !== String(original.recommended_default)) {
      errors.push(`${label}.recommended_default must preserve the agent's original proposal`);
    }
    if (isBlank(decision?.answer)) errors.push(`${label}.answer is required`);
    if (!decision?.answer_source) errors.push(`${label}.answer_source is required`);
    if (typeof decision?.followed_recommendation !== 'boolean') errors.push(`${label}.followed_recommendation must be boolean`);
    if (Number.isNaN(Date.parse(decision?.answered_at))) errors.push(`${label}.answered_at must be ISO-8601`);
  }
  if (!Array.isArray(decisions?.decisions) || decisions.decisions.length === 0) errors.push('decision log decisions must be non-empty');
  if (errors.length) throw new ValidationError(errors);
  return decisions;
}

function findingCounts(findings) {
  const counts = { critical_count: 0, major_count: 0, minor_count: 0, note_count: 0 };
  for (const finding of findings) counts[`${finding.severity}_count`] += 1;
  return counts;
}

async function validateCriticFile(reportFile, manifestFileArg) {
  const errors = [];
  let report;
  try {
    report = readYaml(reportFile);
  } catch (error) {
    throw new ValidationError([`Invalid critic YAML: ${error.message}`]);
  }
  const manifestFile = path.resolve(manifestFileArg);
  const { manifest, projectRoot } = await validateAuthorFile(manifestFile);
  if (report?.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  if (report?.run_id !== manifest.run_id) errors.push('run_id must match the author manifest');
  if (report?.critic_pass !== manifest.revision_count + 1) errors.push('critic_pass must equal revision_count + 1');
  assertPortable(report?.reviewed_manifest, 'reviewed_manifest', errors);
  if (report?.reviewed_manifest && path.resolve(resolveArtifact(projectRoot, report.reviewed_manifest)) !== path.resolve(manifestFile)) {
    errors.push('reviewed_manifest must point to the validated author manifest');
  }
  if (report?.reviewed_fingerprint !== authorReviewFingerprint(manifestFile)) errors.push('reviewed_fingerprint does not match the current author manifest and referenced specifications');
  if (!VERDICTS.has(report?.verdict)) errors.push('verdict is invalid');
  const taskIds = new Set(manifest.tasks.map((task) => String(task.task_id)));
  const findings = asArray(report?.findings);
  const questions = asArray(report?.questions);
  for (const [index, finding] of findings.entries()) {
    const label = `findings[${index}]`;
    for (const field of ['finding_id', 'task_id', 'severity', 'category', 'evidence', 'explanation', 'requested_change']) {
      if (isBlank(finding?.[field])) errors.push(`${label}.${field} is required`);
    }
    if (!taskIds.has(String(finding?.task_id))) errors.push(`${label}.task_id is not in the manifest`);
    if (!SEVERITIES.has(finding?.severity)) errors.push(`${label}.severity is invalid`);
    if (!CATEGORIES.has(finding?.category)) errors.push(`${label}.category is invalid`);
    if (typeof finding?.requires_human !== 'boolean') errors.push(`${label}.requires_human must be boolean`);
  }
  for (const [index, question] of questions.entries()) {
    validateQuestion(question, `questions[${index}]`, question?.task_id, errors);
    if (!taskIds.has(String(question?.task_id))) errors.push(`questions[${index}].task_id is not in the manifest`);
  }
  const expectedCounts = findingCounts(findings.filter((finding) => SEVERITIES.has(finding.severity)));
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (report?.summary?.[key] !== value) errors.push(`summary.${key} must equal ${value}`);
  }
  const reportBlocking = questions.some((question) => question.blocking && isBlank(question.answer));
  const manifestBlocking = manifest.tasks.some((task) => task.questions.some((question) => question.blocking && isBlank(question.answer)));
  const blocking = reportBlocking || manifestBlocking;
  const major = findings.some((finding) => finding.severity === 'critical' || finding.severity === 'major');
  const revisable = findings.some((finding) => (finding.severity === 'critical' || finding.severity === 'major') && !finding.requires_human);
  const atLimit = manifest.revision_count === manifest.max_revisions;
  if (report.verdict === 'READY' && (major || blocking)) errors.push('READY cannot retain critical/major findings or blocking questions');
  if (report.verdict === 'REVISE' && !revisable) errors.push('REVISE requires a source-resolvable critical/major finding');
  if (report.verdict === 'NEEDS_HUMAN' && !reportBlocking) errors.push('NEEDS_HUMAN requires a blocking question in the critic report');
  if (report.verdict === 'BLOCKED_AT_LIMIT' && !major && !blocking) errors.push('BLOCKED_AT_LIMIT requires a remaining critical/major finding or blocking question');
  if (atLimit && report.verdict !== 'READY' && report.verdict !== 'BLOCKED_AT_LIMIT') errors.push('A non-READY final pass must be BLOCKED_AT_LIMIT');
  if (!atLimit && report.verdict === 'BLOCKED_AT_LIMIT') errors.push('BLOCKED_AT_LIMIT requires revision_count == max_revisions');
  if (errors.length) throw new ValidationError(errors);
  return { report, manifest, projectRoot };
}

function relativeFromProject(projectRoot, file) {
  return portablePath(path.resolve(file), projectRoot);
}

async function buildHandoff(args) {
  const manifestFile = path.resolve(required(args, 'manifest'));
  const reportFile = path.resolve(required(args, 'report'));
  const outputFile = path.resolve(required(args, 'out'));
  if (fs.existsSync(outputFile)) throw new Error(`Refusing to overwrite existing handoff: ${outputFile}`);
  const { report, manifest, projectRoot } = await validateCriticFile(reportFile, manifestFile);
  if (report.verdict !== 'READY') throw new Error(`TDD handoff is blocked by verdict ${report.verdict}`);
  portablePath(outputFile, projectRoot);
  const decisionLog = optional(args, 'decision-log') ? path.resolve(args['decision-log']) : null;
  if (decisionLog && !fs.existsSync(decisionLog)) throw new Error(`Decision log not found: ${decisionLog}`);
  if (decisionLog) validateDecisionLogFile(decisionLog, manifestFile);
  const obligations = manifest.tasks.flatMap((task) => task.test_obligations);
  const acceptanceCoverage = {};
  for (const obligation of obligations) {
    for (const ref of asArray(obligation.acceptance_refs)) {
      (acceptanceCoverage[ref] ??= []).push(obligation.obligation_id);
    }
  }
  const decisionVectors = [];
  for (const task of manifest.tasks) {
    for (const specPath of asArray(task.spec_files)) {
      if (!specPath.endsWith('.vectors.yaml')) continue;
      const vectors = readYaml(resolveArtifact(projectRoot, specPath));
      decisionVectors.push({ decision_id: vectors.decision_id, rules: vectors.rules });
    }
  }
  const handoff = {
    schema_version: '1.1',
    run_id: manifest.run_id,
    verdict: 'READY',
    source: manifest.source,
    source_tasks: manifest.tasks.map((task) => ({
      task_id: String(task.task_id),
      title: task.title,
      route: task.route,
      acceptance_refs: asArray(task.acceptance_refs),
    })),
    accepted_specifications: manifest.tasks.flatMap((task) => task.spec_files.map((specPath) => ({
      task_id: String(task.task_id),
      route: task.route,
      path: specPath,
    }))),
    test_obligations: obligations,
    acceptance_coverage: acceptanceCoverage,
    decision_vectors: decisionVectors,
    decision_log: decisionLog ? relativeFromProject(projectRoot, decisionLog) : null,
    critic_report: relativeFromProject(projectRoot, reportFile),
    non_blocking_notes: report.findings
      .filter((finding) => finding.severity === 'minor' || finding.severity === 'note')
      .map((finding) => ({ finding_id: finding.finding_id, task_id: String(finding.task_id), note: finding.explanation })),
  };
  writeYaml(outputFile, handoff);
  console.log(outputFile);
}

function walkFiles(root, predicate) {
  const results = [];
  if (!fs.existsSync(root)) return results;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full, predicate));
    else if (predicate(full)) results.push(full);
  }
  return results;
}

// Re-import input/tasks.json in a scratch directory and compare id, external_ref and title with the fixture's work items.
function checkTaskMasterImport(fixtureRoot) {
  const tasksFile = path.join(fixtureRoot, 'input', 'tasks.json');
  if (!fs.existsSync(tasksFile)) return { status: null };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-cycle-fixture-import-'));
  try {
    fs.copyFileSync(tasksFile, path.join(scratch, 'tasks.json'));
    const config = readYaml(path.join(fixtureRoot, 'input', 'config.yaml'));
    const workItemsFile = path.join(scratch, 'work-items.yaml');
    importTaskMaster({
      projectRoot: scratch,
      tasksFile: path.join(scratch, 'tasks.json'),
      tag: config?.intake?.taskmaster?.tag,
      workItemsFile,
    });
    const pick = (file) => asArray(readYaml(file)?.items).map((item) => ({ id: item.id, external_ref: item.external_ref, title: item.title }));
    const imported = pick(workItemsFile);
    const expected = pick(path.join(fixtureRoot, 'input', 'work-items.yaml'));
    if (!isDeepStrictEqual(imported, expected)) {
      return { status: 'FAIL', reason: `Task Master import differs from input/work-items.yaml: imported ${JSON.stringify(imported)}, fixture ${JSON.stringify(expected)}` };
    }
    return { status: 'PASS' };
  } catch (error) {
    return { status: 'FAIL', reason: `Task Master import failed: ${error.message}` };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function validateFixtures(root) {
  const expectationFiles = walkFiles(root, (file) => path.basename(file) === 'expected.yaml');
  const results = [];
  for (const expectedFile of expectationFiles) {
    const fixtureRoot = path.dirname(expectedFile);
    const expected = readYaml(expectedFile);
    const manifestFile = path.join(fixtureRoot, expected.manifest);
    const reportFile = path.join(fixtureRoot, expected.report);
    try {
      const { manifest } = await validateAuthorFile(manifestFile);
      const { report } = await validateCriticFile(reportFile, manifestFile);
      const routes = manifest.tasks.map((task) => task.route);
      if (JSON.stringify(routes) !== JSON.stringify(expected.routes)) throw new Error(`Expected routes ${expected.routes}, got ${routes}`);
      if (report.verdict !== expected.verdict) throw new Error(`Expected verdict ${expected.verdict}, got ${report.verdict}`);
      const imported = checkTaskMasterImport(fixtureRoot);
      if (imported.status === 'FAIL') {
        results.push({ fixture: path.basename(fixtureRoot), status: 'FAIL', error: imported.reason, taskmaster_import: 'FAIL' });
        continue;
      }
      results.push({ fixture: path.basename(fixtureRoot), status: 'PASS', routes, verdict: report.verdict, taskmaster_import: imported.status });
    } catch (error) {
      results.push({ fixture: path.basename(fixtureRoot), status: 'FAIL', error: error.message });
    }
  }
  console.log(YAML.stringify({ results }, { lineWidth: 0 }));
  if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
  return results;
}

async function metricsCommand(args) {
  const root = path.resolve(required(args, 'root'));
  const outputFile = optional(args, 'out') ? path.resolve(args.out) : null;
  const expectationFiles = walkFiles(root, (file) => path.basename(file) === 'expected.yaml');
  const routeCounts = { PASS: 0, GHERKIN: 0, DMN: 0, BOTH: 0 };
  let taskCount = 0;
  let questionTasks = 0;
  let blockingQuestions = 0;
  let answeredBlockingQuestions = 0;
  let critical = 0;
  let major = 0;
  let minor = 0;
  let firstPassReady = 0;
  let limitHits = 0;
  let revisionTotal = 0;
  let traceable = 0;
  let validationFailures = 0;
  for (const expectedFile of expectationFiles) {
    const fixtureRoot = path.dirname(expectedFile);
    const expected = readYaml(expectedFile);
    const manifestFile = path.join(fixtureRoot, expected.manifest);
    const reportFile = path.join(fixtureRoot, expected.report);
    try {
      const { manifest } = await validateAuthorFile(manifestFile);
      const { report } = await validateCriticFile(reportFile, manifestFile);
      const decisionLogFile = path.join(fixtureRoot, 'run', 'decision-log.yaml');
      const answeredQuestionIds = fs.existsSync(decisionLogFile)
        ? new Set(asArray(readYaml(decisionLogFile)?.decisions).map((decision) => decision.question_id))
        : new Set();
      revisionTotal += manifest.revision_count;
      if (report.critic_pass === 1 && report.verdict === 'READY') firstPassReady += 1;
      if (report.verdict === 'BLOCKED_AT_LIMIT') limitHits += 1;
      critical += report.summary.critical_count;
      major += report.summary.major_count;
      minor += report.summary.minor_count;
      for (const task of manifest.tasks) {
        taskCount += 1;
        routeCounts[task.route] += 1;
        if (task.questions.length > 0) questionTasks += 1;
        for (const question of task.questions) {
          if (question.blocking) {
            blockingQuestions += 1;
            if (!isBlank(question.answer) || answeredQuestionIds.has(question.question_id)) {
              answeredBlockingQuestions += 1;
            }
          }
        }
        if (task.test_obligations.length > 0 && (task.route === 'PASS' || task.spec_files.length > 0)) traceable += 1;
      }
    } catch {
      validationFailures += 1;
    }
  }
  const runCount = expectationFiles.length;
  const formalized = taskCount - routeCounts.PASS;
  const metrics = {
    schema_version: '1.0',
    sample: { runs: runCount, tasks: taskCount },
    route_distribution: routeCounts,
    formalization_rate: taskCount ? formalized / taskCount : 0,
    human_question_rate: taskCount ? questionTasks / taskCount : 0,
    blocking_question_yield: blockingQuestions ? answeredBlockingQuestions / blockingQuestions : 0,
    critic_finding_rate: {
      critical_per_formalized_task: formalized ? critical / formalized : 0,
      major_per_formalized_task: formalized ? major / formalized : 0,
      minor_per_formalized_task: formalized ? minor / formalized : 0,
    },
    first_pass_ready_rate: runCount ? firstPassReady / runCount : 0,
    mean_revision_count: runCount ? revisionTotal / runCount : 0,
    limit_hit_rate: runCount ? limitHits / runCount : 0,
    traceability_completeness: taskCount ? traceable / taskCount : 0,
    validation_failure_rate: runCount ? validationFailures / runCount : 0,
    added_cycle_time: null,
    note: 'Fixture sample only; do not infer production effectiveness.',
  };
  if (outputFile) writeYaml(outputFile, metrics);
  console.log(YAML.stringify(metrics, { lineWidth: 0 }));
}

export {
  ValidationError,
  parseArgs,
  required,
  optional,
  readYaml,
  writeYaml,
  sha256File,
  isBlank,
  asArray,
  isObject,
  portablePath,
  assertPortable,
  findProjectRoot,
  resolveArtifact,
  walkFiles,
  decisionRecordFiles,
  sourceSnapshot,
  readWorkItems,
  flattenWorkItems,
  selectTasks,
  authorReviewFingerprint,
  validateDecision,
  validateAuthorFile,
  validateCriticFile,
  validateDecisionLogFile,
  buildHandoff,
  initCommand,
  resolveInputsCommand,
  normalizeCommand,
  validateFixtures,
  metricsCommand,
  relativeFromProject,
  DEFAULT_CONFIG,
  DEFAULT_RUN_ROOT,
  ITEM_STATUSES,
  ITEM_ID,
};
