import fs from 'node:fs';
import path from 'node:path';
import { asArray, readYaml } from './util.mjs';

const HANDOFF_FILE = 'tdd-handoff.yaml';
const NORMALIZED_FILE = 'normalized-tasks.yaml';

function readOptional(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return readYaml(file);
  } catch {
    return null;
  }
}

function criticPasses(dir) {
  const passes = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^critic-pass-(\d+)\.yaml$/.exec(name);
    if (match) passes.push({ n: Number(match[1]), file: path.join(dir, name) });
  }
  return passes.sort((a, b) => b.n - a.n);
}

const coversTask = (tasks, taskId) => asArray(tasks).some((task) => String(task?.task_id) === taskId);

// One run directory as seen by `status` and `resolve-handoff`. Its recency is the mtime of the
// newest artefact the gate writes last: the handoff, else the highest critic pass, else the
// normalized snapshot. Returns null when the run does not cover the task.
function describeRun(runRootDir, name, taskId) {
  const dir = path.join(runRootDir, name);
  const handoffFile = path.join(dir, HANDOFF_FILE);
  const normalizedFile = path.join(dir, NORMALIZED_FILE);
  const handoff = readOptional(handoffFile);
  const normalized = readOptional(normalizedFile);
  const handoffCovers = coversTask(handoff?.source_tasks, taskId);
  if (!handoffCovers && !coversTask(normalized?.tasks, taskId)) return null;
  const passes = criticPasses(dir);
  let recencyFile = normalizedFile;
  if (handoff) recencyFile = handoffFile;
  else if (passes.length > 0) recencyFile = passes[0].file;
  return {
    name,
    dir,
    handoff: handoffCovers ? handoff : null,
    handoffFile: handoffCovers ? handoffFile : null,
    topPass: passes[0] ?? null,
    mtimeMs: fs.existsSync(recencyFile) ? fs.statSync(recencyFile).mtimeMs : 0,
  };
}

// The newest run that covers the task (ties: the greatest directory name). With requireHandoff,
// only runs whose READY handoff names the task are candidates, so the result is the newest handoff.
function latestRunFor({ projectRoot, runRoot, taskId, requireHandoff = false }) {
  const runRootDir = path.resolve(projectRoot, runRoot);
  if (!fs.existsSync(runRootDir) || !fs.statSync(runRootDir).isDirectory()) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(runRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const described = describeRun(runRootDir, entry.name, String(taskId));
    if (!described || (requireHandoff && !described.handoff)) continue;
    candidates.push(described);
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));
  return candidates[0] ?? null;
}

export { latestRunFor, HANDOFF_FILE, NORMALIZED_FILE };
