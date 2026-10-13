import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { optional } from './util.mjs';
import { matchGlobs } from './glob.mjs';

const TEST_GLOB_CANDIDATES = ['*Tests/**/*.swift', 'tests/**', 'test/**', 'src/**/*.spec.ts', 'src/**/*.test.ts'];

// Probe failures (missing binary, non-zero exit) are reported as status 127, never thrown.
export function defaultExec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) return { status: 127, stdout: '' };
  return { status: result.status ?? 127, stdout: result.stdout ?? '' };
}

function probe(exec, command, args) {
  try {
    const result = exec(command, args);
    return { status: result?.status ?? 127, stdout: typeof result?.stdout === 'string' ? result.stdout : '' };
  } catch {
    return { status: 127, stdout: '' };
  }
}

function existingFile(projectRoot, relative) {
  return fs.statSync(path.join(projectRoot, relative), { throwIfNoEntry: false })?.isFile() ? relative : null;
}

function markdownIn(projectRoot, directory, predicate = () => true) {
  const full = path.join(projectRoot, directory);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

export function detect({ projectRoot, exec = defaultExec }) {
  const cli = probe(exec, 'which', ['task-master']).status === 0;
  const tasksFile = existingFile(projectRoot, '.taskmaster/tasks/tasks.json');
  const plugins = probe(exec, 'claude', ['plugin', 'list']);
  const superpowers = plugins.status === 0 && /superpowers@/.test(plugins.stdout);

  const baselineCandidates = [
    ...['docs/PRD.md', 'docs/TECH_STACK.md'].filter((file) => existingFile(projectRoot, file)),
    ...markdownIn(projectRoot, 'docs', (name) => /^REQUIREMENT.*\.md$/.test(name)),
    ...['.taskmaster/docs/prd.md'].filter((file) => existingFile(projectRoot, file)),
    ...markdownIn(projectRoot, 'docs/superpowers/specs', (name) => name.endsWith('.md')),
  ];

  const decisionDirectory = path.join(projectRoot, 'docs/decisions');
  const testGlobs = TEST_GLOB_CANDIDATES.filter((pattern) => matchGlobs(projectRoot, [pattern]).length > 0);

  return {
    task_master: { cli, tasks_file: tasksFile },
    superpowers,
    baseline_candidates: baselineCandidates,
    decision_records_candidate: fs.statSync(decisionDirectory, { throwIfNoEntry: false })?.isDirectory()
      ? 'docs/decisions'
      : null,
    test_glob_candidates: testGlobs,
    existing_config: {
      spec_gate: existingFile(projectRoot, '.spec-gate/config.yaml'),
      spec_cycle: existingFile(projectRoot, '.spec-cycle/config.yaml'),
    },
    suggested: {
      intake: cli && tasksFile ? 'taskmaster' : 'native',
      execution: superpowers ? 'superpowers' : 'inline',
    },
  };
}

export function detectCommand(args) {
  const projectRoot = path.resolve(optional(args, 'project') ?? process.cwd());
  console.log(YAML.stringify(detect({ projectRoot }), { lineWidth: 0 }).trimEnd());
}
