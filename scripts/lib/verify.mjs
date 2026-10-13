import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { ValidationError, asArray, optional, readYaml, required, writeYaml } from './util.mjs';
import { loadConfig } from './config.mjs';
import { flattenWorkItems, readWorkItems } from './core.mjs';
import { matchGlobs } from './glob.mjs';
import { escapeRegExp, idPattern } from './ids.mjs';
import { resolveHandoff } from './handoff.mjs';
import { setStatus } from './work-items.mjs';

const VERIFICATION_FILE = 'verification.yaml';
const NORMALIZED_FILE = 'normalized-tasks.yaml';
const NO_FILES_ERROR = 'verification.test_globs matched no files; set it in .spec-cycle/config.yaml';

function matcherFor(idPatternText, id) {
  if (idPatternText === null || idPatternText === undefined) return idPattern(id);
  return new RegExp(String(idPatternText).replaceAll('{id}', escapeRegExp(id)));
}

function verifyObligations({ projectRoot, configArg = null, taskId, outFile = null, markDone = false }) {
  const resolution = resolveHandoff({ projectRoot, configArg, taskId });
  if (!resolution.usable) throw new ValidationError(resolution.errors);
  const config = loadConfig(projectRoot, configArg);
  const testGlobs = asArray(config.verification?.test_globs);
  const files = testGlobs.length ? matchGlobs(projectRoot, testGlobs) : [];
  if (files.length === 0) throw new ValidationError([NO_FILES_ERROR]);

  const handoff = readYaml(path.join(projectRoot, resolution.handoff));
  const lines = files.map((file) => ({ file, lines: fs.readFileSync(path.join(projectRoot, file), 'utf8').split(/\r?\n/) }));
  const obligations = asArray(handoff.test_obligations).map((obligation) => {
    const id = String(obligation.obligation_id);
    const matcher = matcherFor(config.verification?.id_pattern, id);
    const locations = [];
    for (const { file, lines: fileLines } of lines) {
      fileLines.forEach((line, index) => {
        if (matcher.test(line)) locations.push(`${file}:${index + 1}`);
      });
    }
    locations.sort();
    return { obligation_id: id, covered: locations.length > 0, locations };
  });
  const uncovered = obligations.filter((obligation) => !obligation.covered);
  const report = {
    schema_version: '1.0',
    run_id: resolution.run_id,
    task_id: taskId,
    checked_at: new Date().toISOString(),
    test_globs: testGlobs,
    obligations,
    uncovered_count: uncovered.length,
    test_command: null,
    status_written: null,
  };
  const target = outFile ? path.resolve(projectRoot, outFile) : path.join(projectRoot, resolution.run_dir, VERIFICATION_FILE);
  writeYaml(target, report);

  if (markDone) {
    if (uncovered.length > 0) {
      const error = new ValidationError([`${uncovered.length} obligation(s) uncovered; status unchanged`]);
      error.report = report;
      throw error;
    }
    setStatus({ projectRoot, workItemsFile: path.join(projectRoot, config.work_items), taskId, status: 'done' });
    report.status_written = 'done';
    writeYaml(target, report);
  }
  return report;
}

function newestMtime(file) {
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
}

function criticPasses(dir) {
  const passes = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^critic-pass-(\d+)\.yaml$/.exec(name);
    if (match) passes.push({ n: Number(match[1]), file: path.join(dir, name) });
  }
  return passes.sort((a, b) => b.n - a.n);
}

function runsFor(runRootDir) {
  const runs = [];
  if (!fs.existsSync(runRootDir) || !fs.statSync(runRootDir).isDirectory()) return runs;
  for (const entry of fs.readdirSync(runRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runRootDir, entry.name);
    const normalizedFile = path.join(dir, NORMALIZED_FILE);
    if (!fs.existsSync(normalizedFile)) continue;
    let normalized;
    try {
      normalized = readYaml(normalizedFile);
    } catch {
      continue;
    }
    const passes = criticPasses(dir);
    runs.push({
      name: entry.name,
      dir,
      taskIds: new Set(asArray(normalized?.tasks).map((task) => String(task?.task_id))),
      topPass: passes[0] ?? null,
      passMtime: passes[0] ? newestMtime(passes[0].file) : 0,
      normalizedMtime: newestMtime(normalizedFile),
    });
  }
  return runs;
}

function latestRun(runs) {
  // Greatest critic pass wins, ties by that pass file's mtime; runs without a pass rank below, by normalized mtime.
  const rank = (run) => [run.topPass ? run.topPass.n : -1, run.passMtime, run.normalizedMtime];
  return [...runs].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return right[i] - left[i];
    return a.name < b.name ? 1 : -1;
  })[0] ?? null;
}

function coverageOf(dir) {
  const file = path.join(dir, VERIFICATION_FILE);
  if (!fs.existsSync(file)) return null;
  const obligations = asArray(readYaml(file)?.obligations);
  return `${obligations.filter((obligation) => obligation?.covered === true).length}/${obligations.length}`;
}

function statusTable({ projectRoot, configArg = null }) {
  const config = loadConfig(projectRoot, configArg);
  const { tasks } = flattenWorkItems(readWorkItems(path.join(projectRoot, config.work_items)), config.work_items);
  const runs = runsFor(path.join(projectRoot, config.run_root));
  return tasks.map((task) => {
    const run = latestRun(runs.filter((candidate) => candidate.taskIds.has(task.task_id)));
    return {
      id: task.task_id,
      title: task.title,
      status: task.status,
      latest_run: run ? run.name : null,
      verdict: run?.topPass ? (readYaml(run.topPass.file)?.verdict ?? null) : null,
      handoff: run ? fs.existsSync(path.join(run.dir, 'tdd-handoff.yaml')) : false,
      coverage: run ? coverageOf(run.dir) : null,
    };
  });
}

function verifyObligationsCommand(args) {
  let report;
  let blocked = [];
  try {
    report = verifyObligations({
      projectRoot: process.cwd(),
      configArg: optional(args, 'config'),
      taskId: required(args, 'task'),
      outFile: optional(args, 'out'),
      markDone: args['mark-done'] === true,
    });
  } catch (error) {
    if (!(error instanceof ValidationError) || !error.report) throw error;
    report = error.report;
    blocked = error.errors;
  }
  process.stdout.write(YAML.stringify(report, { lineWidth: 0 }));
  const errors = report.obligations
    .filter((obligation) => !obligation.covered)
    .map((obligation) => `obligation ${obligation.obligation_id} is not covered by any test`);
  if (errors.length > 0) throw new ValidationError([...errors, ...blocked]);
}

function statusCommand(args) {
  const rows = statusTable({ projectRoot: process.cwd(), configArg: optional(args, 'config') });
  process.stdout.write(YAML.stringify(rows, { lineWidth: 0 }));
}

export { verifyObligations, statusTable, verifyObligationsCommand, statusCommand };
