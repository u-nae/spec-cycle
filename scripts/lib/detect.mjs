import fs from 'node:fs';
import os from 'node:os';
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

// Claude Code keeps installed plugins under <config dir>/plugins/cache/<marketplace>/<plugin>/<version>/.
function cachedSuperpowers(configDir) {
  const cache = path.join(configDir, 'plugins', 'cache');
  if (!fs.existsSync(cache)) return false;
  for (const marketplace of fs.readdirSync(cache, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const plugin = path.join(cache, marketplace.name, 'superpowers');
    if (!fs.existsSync(plugin)) continue;
    for (const version of fs.readdirSync(plugin, { withFileTypes: true })) {
      if (version.isDirectory() && fs.existsSync(path.join(plugin, version.name, 'skills', 'writing-plans', 'SKILL.md'))) return true;
    }
  }
  return false;
}

// `claude plugin list` is the answer when it runs. When it fails (a transient API error, say) the plugin
// cache is the second look; with neither, the result is null (unknown), never false (not installed).
function superpowersStatus(exec, configDir) {
  const plugins = probe(exec, 'claude', ['plugin', 'list']);
  if (plugins.status === 0) return { installed: /superpowers@/.test(plugins.stdout), source: 'plugin-list' };
  if (cachedSuperpowers(configDir)) return { installed: true, source: 'plugin-cache' };
  return { installed: null, source: 'unavailable' };
}

export function detect({
  projectRoot, exec = defaultExec, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
}) {
  const cli = probe(exec, 'which', ['task-master']).status === 0;
  const tasksFile = existingFile(projectRoot, '.taskmaster/tasks/tasks.json');
  const { installed: superpowers, source: superpowersSource } = superpowersStatus(exec, configDir);

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
    superpowers_source: superpowersSource,
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
      execution: superpowers === true ? 'superpowers' : 'inline',
    },
  };
}

export function detectCommand(args) {
  const projectRoot = path.resolve(optional(args, 'project') ?? process.cwd());
  console.log(YAML.stringify(detect({ projectRoot }), { lineWidth: 0 }).trimEnd());
}
