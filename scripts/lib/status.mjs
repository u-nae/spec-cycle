import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { asArray, isBlank, optional, portablePath, readYaml } from './util.mjs';
import { DEFAULT_CONFIG, loadConfig } from './config.mjs';
import { flattenWorkItems, readWorkItems } from './core.mjs';
import { resolveHandoff } from './handoff.mjs';
import { latestRunFor } from './runs.mjs';
import { statusCommand as yamlStatusCommand } from './verify.mjs';

// The machine-readable status snapshot (contracts.md "Status snapshot"). Everything here is derived
// from the same functions the human-facing subcommands use, so a reader of status.json sees what
// `status`, `resolve-handoff` and `verify-obligations` would say; nothing is judged anew.
const SCHEMA_VERSION = '1.0';
const SNAPSHOT_FILE = 'status.json';
const PLUGIN_MANIFEST = path.resolve(import.meta.dirname, '..', '..', '.claude-plugin', 'plugin.json');
const VERIFICATION_FILE = 'verification.yaml';
const QUESTIONS_FILE = 'questions.yaml';
const DECISION_LOG_FILE = 'decision-log.yaml';
const BRIEF_FILE = 'spec-brief.md';

function pluginVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8')).version);
  } catch {
    return 'unknown';
  }
}

function readOptional(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return readYaml(file);
  } catch {
    return null;
  }
}

function mtimeMs(file) {
  return Math.round(fs.statSync(file).mtimeMs);
}

// The newest mtime under a directory, the directory itself included: a cheap "did any record change"
// signal for readers that do not want to hash the set.
function dirMaxMtimeMs(dir) {
  let newest = mtimeMs(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? dirMaxMtimeMs(full) : mtimeMs(full));
  }
  return newest;
}

function inputsOf(projectRoot, config) {
  const inputs = [];
  for (const doc of [...config.baseline, config.work_items]) {
    const full = path.join(projectRoot, doc);
    if (fs.existsSync(full)) inputs.push({ path: doc, mtime_ms: mtimeMs(full) });
  }
  if (config.decision_records) {
    const full = path.join(projectRoot, config.decision_records);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      inputs.push({ path: config.decision_records, mtime_ms: dirMaxMtimeMs(full), kind: 'dir-max' });
    }
  }
  return inputs;
}

// external_ref is not part of the normalized task, so it is read from the raw list.
function externalRefs(items, parent = null, index = new Map()) {
  for (const item of asArray(items)) {
    if (isBlank(item?.id)) continue;
    const id = parent ? `${parent}.${item.id}` : String(item.id);
    index.set(id, isBlank(item.external_ref) ? null : item.external_ref);
    externalRefs(item.subtasks, id, index);
  }
  return index;
}

function latestManifest(dir) {
  let best = null;
  for (const name of fs.readdirSync(dir)) {
    const match = /^author-manifest-revision-(\d+)\.yaml$/.exec(name);
    if (match && (best === null || Number(match[1]) > best.n)) best = { n: Number(match[1]), file: path.join(dir, name) };
  }
  const file = best ? best.file : path.join(dir, 'author-manifest.yaml');
  return readOptional(file);
}

function criticReports(dir) {
  const reports = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^critic-pass-(\d+)\.yaml$/.exec(name);
    if (match) reports.push({ n: Number(match[1]), file: path.join(dir, name) });
  }
  return reports.sort((a, b) => a.n - b.n);
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function findingCounts(summary) {
  if (summary === null || typeof summary !== 'object') return null;
  const count = (key) => integerOrNull(summary[key]) ?? 0;
  return { critical: count('critical_count'), major: count('major_count'), minor: count('minor_count'), note: count('note_count') };
}

// Unanswered questions of the task: from questions.yaml when the run has one, else from the newest
// critic report. An answer recorded in the decision log counts as an answer.
function openQuestions(dir, taskId, topReport) {
  const questionsFile = path.join(dir, QUESTIONS_FILE);
  const source = fs.existsSync(questionsFile) ? asArray(readOptional(questionsFile)?.questions) : asArray(topReport?.questions);
  const decided = new Set(asArray(readOptional(path.join(dir, DECISION_LOG_FILE))?.decisions).map((decision) => String(decision?.question_id)));
  return source
    .filter((question) => String(question?.task_id) === taskId && isBlank(question?.answer) && !decided.has(String(question?.question_id)))
    .map((question) => {
      const recommended = asArray(question.options).find((option) => String(option?.id) === String(question.recommended_default));
      return {
        question_id: String(question.question_id),
        question: question.question ?? null,
        blocking: question.blocking === true,
        recommended_default: question.recommended_default ?? null,
        recommended_label: recommended?.label ?? null,
        recommendation_rationale: question.recommendation_rationale ?? null,
      };
    });
}

function describeRun(projectRoot, run, taskId) {
  const relative = (file) => portablePath(file, projectRoot);
  const existing = (name) => (fs.existsSync(path.join(run.dir, name)) ? relative(path.join(run.dir, name)) : null);
  const manifest = latestManifest(run.dir);
  const task = asArray(manifest?.tasks).find((entry) => String(entry?.task_id) === taskId) ?? null;
  const reports = criticReports(run.dir);
  const top = reports.length > 0 ? readOptional(reports[reports.length - 1].file) : null;
  const specFiles = asArray(task?.spec_files)
    .filter((spec) => typeof spec === 'string' && fs.existsSync(path.resolve(projectRoot, spec)))
    .map((spec) => relative(path.resolve(projectRoot, spec)));
  return {
    id: run.name,
    dir: relative(run.dir),
    updated_at: new Date(run.mtimeMs).toISOString(),
    revision_count: integerOrNull(manifest?.revision_count),
    max_revisions: integerOrNull(manifest?.max_revisions),
    critic_passes: reports.length,
    verdict: top?.verdict ?? null,
    findings: top ? findingCounts(top.summary) : null,
    open_questions: openQuestions(run.dir, taskId, top),
    route: task?.route ?? null,
    artifacts: {
      handoff: run.handoffFile ? relative(run.handoffFile) : null,
      brief: existing(BRIEF_FILE),
      verification: existing(VERIFICATION_FILE),
      decision_log: existing(DECISION_LOG_FILE),
      critic_reports: reports.map((report) => relative(report.file)),
      spec_files: specFiles,
    },
  };
}

function describeHandoff({ projectRoot, configArg, taskId, run }) {
  const resolution = resolveHandoff({ projectRoot, configArg, taskId });
  const obligations = asArray(run.handoff.test_obligations);
  const mine = obligations.filter((obligation) => obligation?.task_id === undefined || String(obligation.task_id) === taskId);
  return { usable: resolution.usable, errors: resolution.errors, warnings: resolution.warnings, obligations_total: mine.length };
}

function testsOf(report) {
  const exitCode = report?.test_command?.exit_code;
  if (exitCode === 0) return 'passed';
  if (Number.isInteger(exitCode)) return 'failed';
  if (report?.human_confirmed_tests === true) return 'confirmed';
  return 'unknown';
}

function describeVerification(dir) {
  const file = path.join(dir, VERIFICATION_FILE);
  if (!fs.existsSync(file)) return null;
  const report = readOptional(file);
  const obligations = asArray(report?.obligations);
  return {
    covered: obligations.filter((obligation) => obligation?.covered === true).length,
    total: obligations.length,
    checked_at: report?.checked_at ?? null,
    tests: testsOf(report),
    status_written: report?.status_written ?? null,
  };
}

function buildStatusSnapshot({ projectRoot, configArg = null, generatedBy = 'status', now = new Date() }) {
  const config = loadConfig(projectRoot, configArg);
  const rawItems = readWorkItems(path.join(projectRoot, config.work_items));
  const tasks = rawItems.length === 0 ? [] : flattenWorkItems(rawItems, config.work_items).tasks;
  const refs = externalRefs(rawItems);
  const statusById = new Map(tasks.map((task) => [task.task_id, task.status]));
  const items = tasks.map((task) => {
    const run = latestRunFor({ projectRoot, runRoot: config.run_root, taskId: task.task_id });
    return {
      id: task.task_id,
      parent_id: task.parent_task_id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dependencies: task.dependencies,
      dependencies_done: task.dependencies.every((dependency) => statusById.get(dependency) === 'done'),
      external_ref: refs.get(task.task_id) ?? null,
      run: run ? describeRun(projectRoot, run, task.task_id) : null,
      handoff: run?.handoff ? describeHandoff({ projectRoot, configArg, taskId: task.task_id, run }) : null,
      verification: run ? describeVerification(run.dir) : null,
    };
  });
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: now.toISOString(),
    generated_by: `spec-cycle@${pluginVersion()} ${generatedBy}`,
    config: {
      path: config.path,
      intake: config.intake.adapter,
      execution: config.execution.adapter,
      run_root: config.run_root,
      work_items: config.work_items,
    },
    inputs: inputsOf(projectRoot, config),
    items,
  };
}

function snapshotFile(projectRoot, config) {
  return path.join(projectRoot, path.dirname(config.path), SNAPSHOT_FILE);
}

// Temporary file then rename, so a reader never sees a partial document.
function writeStatusSnapshot({ projectRoot, configArg = null, generatedBy }) {
  const snapshot = buildStatusSnapshot({ projectRoot, configArg, generatedBy });
  const file = snapshotFile(projectRoot, loadConfig(projectRoot, configArg));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { file, snapshot };
}

// The project a run artifact belongs to: the nearest ancestor holding the default config. Null when
// the artifact is not inside a spec-cycle project (a fixture validated on its own), so nothing is written.
function projectRootForArtifact(file) {
  let current = path.dirname(path.resolve(file));
  const filesystemRoot = path.parse(current).root;
  while (true) {
    if (fs.existsSync(path.join(current, DEFAULT_CONFIG))) return current;
    if (current === filesystemRoot) return null;
    current = path.dirname(current);
  }
}

// Called as the last step of a state-changing subcommand. Never throws and never changes the
// command's exit code: a failure is one warning line on stderr (contracts.md "Status snapshot").
function refreshStatusSnapshot({ projectRoot = process.cwd(), configArg = null, command }) {
  if (projectRoot === null) return null;
  try {
    if (!fs.existsSync(path.resolve(projectRoot, configArg ?? DEFAULT_CONFIG))) return null;
    return writeStatusSnapshot({ projectRoot, configArg, generatedBy: command });
  } catch (error) {
    const reason = String(error?.message ?? error).split('\n')[0];
    process.stderr.write(`spec-cycle: status snapshot not written (${reason})\n`);
    return null;
  }
}

function statusCommand(args) {
  const projectRoot = process.cwd();
  const configArg = optional(args, 'config');
  if (args.json !== true && args.write !== true) {
    // The YAML table stays byte-identical to spec-cycle 0.3.0 (contracts.md "Status snapshot").
    yamlStatusCommand(args);
    return;
  }
  const snapshot = args.write === true
    ? writeStatusSnapshot({ projectRoot, configArg, generatedBy: 'status --write' }).snapshot
    : buildStatusSnapshot({ projectRoot, configArg, generatedBy: 'status' });
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

export {
  buildStatusSnapshot, writeStatusSnapshot, refreshStatusSnapshot, projectRootForArtifact, statusCommand, SNAPSHOT_FILE,
};
