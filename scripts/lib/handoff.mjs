import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { ValidationError, asArray, optional, portablePath, readYaml, required } from './util.mjs';
import { loadConfig } from './config.mjs';
import { decisionRecordFiles, flattenWorkItems, readWorkItems, sourceSnapshot } from './core.mjs';
import { definitionalFields } from './work-items.mjs';

const HANDOFF_FILE = 'tdd-handoff.yaml';
const NORMALIZED_FILE = 'normalized-tasks.yaml';
const FIELD_ORDER = ['title', 'description', 'details', 'test_strategy', 'dependencies', 'source_refs', 'acceptance_refs'];

// The newest handoff (by file mtime, then directory name) among runs that cover the task.
function findLatestHandoff(runRootDir, taskId) {
  if (!fs.existsSync(runRootDir) || !fs.statSync(runRootDir).isDirectory()) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(runRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(runRootDir, entry.name, HANDOFF_FILE);
    if (!fs.existsSync(file)) continue;
    let handoff;
    try {
      handoff = readYaml(file);
    } catch {
      continue;
    }
    if (!asArray(handoff?.source_tasks).some((task) => String(task?.task_id) === taskId)) continue;
    candidates.push({ name: entry.name, file, handoff, mtimeMs: fs.statSync(file).mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));
  return candidates[0] ?? null;
}

function resolveHandoff({ projectRoot, configArg = null, taskId }) {
  const config = loadConfig(projectRoot, configArg);
  const found = findLatestHandoff(path.join(projectRoot, config.run_root), taskId);
  const { tasks } = flattenWorkItems(readWorkItems(path.join(projectRoot, config.work_items)), config.work_items);
  const current = tasks.find((task) => task.task_id === taskId) ?? null;
  const resolution = {
    task_id: taskId, run_id: null, run_dir: null, handoff: null, brief: null, handoff_schema: null,
    usable: false, errors: [], warnings: [], work_item_status: current ? current.status : null,
  };
  if (!found) {
    resolution.errors.push(`no READY handoff for ${taskId}; run /spec-cycle:run ${taskId} first`);
    return resolution;
  }

  const runDir = portablePath(path.join(projectRoot, config.run_root, found.name), projectRoot);
  resolution.run_id = found.name;
  resolution.run_dir = runDir;
  resolution.handoff = `${runDir}/${HANDOFF_FILE}`;
  resolution.brief = `${runDir}/spec-brief.md`;
  resolution.handoff_schema = found.handoff.schema_version === undefined ? null : String(found.handoff.schema_version);
  const { errors, warnings } = resolution;

  const snapshot = sourceSnapshot(projectRoot, config);
  const source = found.handoff.source ?? {};

  for (const doc of asArray(source.baseline)) {
    const now = snapshot.baseline.find((entry) => entry.path === doc.path);
    if (!now || now.fingerprint !== doc.fingerprint) {
      errors.push(`baseline ${doc.path} changed since the handoff; rerun the gate`);
    }
  }

  if (!current) {
    errors.push(`work item ${taskId} not found in ${config.work_items}`);
  } else {
    const normalizedFile = path.join(projectRoot, runDir, NORMALIZED_FILE);
    if (!fs.existsSync(normalizedFile)) {
      errors.push(`${NORMALIZED_FILE} missing in ${runDir}; rerun the gate`);
    } else {
      const snapshotted = asArray(readYaml(normalizedFile)?.tasks).find((task) => String(task?.task_id) === taskId);
      if (!snapshotted) {
        errors.push(`${NORMALIZED_FILE} in ${runDir} has no task ${taskId}; rerun the gate`);
      } else {
        const before = definitionalFields(snapshotted);
        const after = definitionalFields(current);
        const changed = FIELD_ORDER.filter((field) => !isDeepStrictEqual(before[field], after[field]));
        if (changed.length > 0) {
          errors.push(`work item ${taskId} definition changed (fields: ${changed.join(', ')}); rerun the gate`);
        }
      }
    }
  }

  if (source.decision_records?.fingerprint !== snapshot.decision_records.fingerprint) {
    // The handoff stores no per-file hashes, so "newer than the handoff" stands in for "new or edited".
    const newer = decisionRecordFiles(projectRoot, config.decision_records)
      .filter((file) => fs.statSync(path.join(projectRoot, file)).mtimeMs > found.mtimeMs);
    warnings.push(`decision records changed since the handoff: ${newer.length > 0 ? newer.join(', ') : '(unknown)'}`);
  }

  if (current?.status === 'done') warnings.push(`work item ${taskId} is already done`);

  resolution.usable = errors.length === 0;
  return resolution;
}

function resolveHandoffCommand(args) {
  const projectRoot = path.resolve(optional(args, 'project') ?? process.cwd());
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root not found: ${projectRoot}`);
  const resolution = resolveHandoff({
    projectRoot, configArg: optional(args, 'config'), taskId: required(args, 'task'),
  });
  process.stdout.write(YAML.stringify(resolution, { lineWidth: 0 }));
  if (!resolution.usable) throw new ValidationError(resolution.errors);
}

export { resolveHandoff, resolveHandoffCommand };
