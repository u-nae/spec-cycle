import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  ValidationError, required, optional, readYaml, writeYaml, isBlank, asArray, portablePath, assertPortable,
} from './util.mjs';

const DEFAULT_CONFIG = '.spec-cycle/config.yaml';
const DEFAULT_RUN_ROOT = '.spec-cycle/runs';
const SCHEMA_VERSIONS = new Set(['1.0', '1.1']);
const INTAKE_ADAPTERS = ['native', 'taskmaster'];
const EXECUTION_ADAPTERS = ['superpowers', 'inline', 'command'];
const DEFAULT_TASKMASTER_TASKS = '.taskmaster/tasks/tasks.json';
const DEFAULT_PLAN_DIR = 'docs/superpowers/plans';

function loadConfig(projectRoot, configArg) {
  const relative = configArg || DEFAULT_CONFIG;
  const full = path.resolve(projectRoot, relative);
  if (!fs.existsSync(full)) {
    throw new ValidationError([
      `Spec gate config not found: ${relative}`,
      'Create it with: spec-cycle.mjs init --baseline <doc>[,<doc>...] [--decision-records <dir>] [--work-items <file>]',
    ]);
  }
  const config = readYaml(full);
  const errors = [];
  if (!SCHEMA_VERSIONS.has(config?.schema_version)) errors.push(`${relative}: schema_version must be 1.0 or 1.1`);
  const baseline = asArray(config?.baseline);
  if (baseline.length === 0) errors.push(`${relative}: baseline must list at least one document`);
  for (const [index, doc] of baseline.entries()) {
    if (assertPortable(doc, `${relative}: baseline[${index}]`, errors) && !fs.existsSync(path.join(projectRoot, doc))) {
      errors.push(`${relative}: baseline document not found: ${doc}`);
    }
  }
  if (new Set(baseline).size !== baseline.length) errors.push(`${relative}: baseline contains duplicates`);
  if (!isBlank(config?.decision_records)) assertPortable(config.decision_records, `${relative}: decision_records`, errors);
  if (assertPortable(config?.work_items, `${relative}: work_items`, errors) && !fs.existsSync(path.join(projectRoot, config.work_items))) {
    errors.push(`${relative}: work item list not found: ${config.work_items}`);
  }
  const runRoot = config?.run_root ?? DEFAULT_RUN_ROOT;
  assertPortable(runRoot, `${relative}: run_root`, errors);
  const sections = resolveSections(config, relative, errors);
  if (errors.length) throw new ValidationError(errors);
  return {
    path: portablePath(full, projectRoot),
    baseline,
    decision_records: isBlank(config.decision_records) ? null : config.decision_records,
    work_items: config.work_items,
    run_root: runRoot,
    schema_version: config.schema_version,
    ...sections,
  };
}

function section(config, key) {
  const value = config?.[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveSections(config, relative, errors) {
  const intake = section(config, 'intake');
  const taskmaster = section(intake, 'taskmaster');
  const execution = section(config, 'execution');
  const verification = section(config, 'verification');

  const intakeAdapter = intake.adapter ?? 'native';
  if (!INTAKE_ADAPTERS.includes(intakeAdapter)) {
    errors.push(`${relative}: intake.adapter must be one of ${INTAKE_ADAPTERS.join(', ')}`);
  }
  const tasks = taskmaster.tasks ?? DEFAULT_TASKMASTER_TASKS;
  assertPortable(tasks, `${relative}: intake.taskmaster.tasks`, errors);

  const executionAdapter = execution.adapter ?? 'inline';
  if (!EXECUTION_ADAPTERS.includes(executionAdapter)) {
    errors.push(`${relative}: execution.adapter must be one of ${EXECUTION_ADAPTERS.join(', ')}`);
  } else if (executionAdapter === 'command' && isBlank(execution.command)) {
    errors.push(`${relative}: execution.command is required when execution.adapter is command`);
  }
  const planDir = execution.plan_dir ?? DEFAULT_PLAN_DIR;
  assertPortable(planDir, `${relative}: execution.plan_dir`, errors);

  const testGlobs = verification.test_globs ?? [];
  if (!Array.isArray(testGlobs) || !testGlobs.every((glob) => typeof glob === 'string')) {
    errors.push(`${relative}: verification.test_globs must be a list of strings`);
  }
  const idPattern = isBlank(verification.id_pattern) ? null : verification.id_pattern;
  if (idPattern !== null && (typeof idPattern !== 'string' || !idPattern.includes('{id}'))) {
    errors.push(`${relative}: verification.id_pattern must contain {id}`);
  }
  return {
    intake: { adapter: intakeAdapter, taskmaster: { tasks, tag: isBlank(taskmaster.tag) ? null : taskmaster.tag } },
    execution: {
      adapter: executionAdapter,
      command: isBlank(execution.command) ? null : execution.command,
      plan_dir: planDir,
    },
    verification: {
      test_globs: asArray(testGlobs),
      id_pattern: idPattern,
      test_command: isBlank(verification.test_command) ? null : verification.test_command,
    },
  };
}

function splitList(value) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function adoptDefaults(projectRoot, adoptArg) {
  const errors = [];
  if (!assertPortable(adoptArg, 'adopt', errors)) throw new ValidationError(errors);
  const file = path.join(projectRoot, adoptArg);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ValidationError([`adopt config not found: ${adoptArg}`]);
  const adopted = readYaml(file);
  if (adopted === null || typeof adopted !== 'object' || Array.isArray(adopted)) {
    throw new ValidationError([`adopt config is not a mapping: ${adoptArg}`]);
  }
  return adopted;
}

function initCommand(args) {
  const projectRoot = path.resolve(optional(args, 'project') ?? process.cwd());
  const configFile = path.join(projectRoot, DEFAULT_CONFIG);
  if (fs.existsSync(configFile)) throw new Error(`Refusing to overwrite existing config: ${DEFAULT_CONFIG}`);
  const adoptArg = optional(args, 'adopt');
  const adopted = adoptArg ? adoptDefaults(projectRoot, adoptArg) : {};
  const baselineArg = optional(args, 'baseline');
  const baseline = baselineArg ? splitList(baselineArg) : (adoptArg ? asArray(adopted.baseline) : splitList(required(args, 'baseline')));
  const decisionRecords = optional(args, 'decision-records') ?? (isBlank(adopted.decision_records) ? null : adopted.decision_records);
  const workItems = optional(args, 'work-items') ?? adopted.work_items ?? 'docs/work-items.yaml';
  const runRoot = optional(args, 'run-root') ?? adopted.run_root ?? DEFAULT_RUN_ROOT;
  const intakeAdapter = optional(args, 'intake') ?? 'native';
  const executionAdapter = optional(args, 'execution') ?? 'inline';
  const command = optional(args, 'command');
  const testGlobsArg = optional(args, 'test-globs');
  const errors = [];
  if (baseline.length === 0) errors.push('baseline must list at least one document');
  for (const doc of baseline) {
    if (assertPortable(doc, `baseline ${doc}`, errors) && !fs.existsSync(path.join(projectRoot, doc))) {
      errors.push(`baseline document not found: ${doc}`);
    }
  }
  if (decisionRecords) assertPortable(decisionRecords, 'decision-records', errors);
  assertPortable(workItems, 'work-items', errors);
  assertPortable(runRoot, 'run-root', errors);
  if (!INTAKE_ADAPTERS.includes(intakeAdapter)) errors.push(`intake must be one of ${INTAKE_ADAPTERS.join(', ')}`);
  if (!EXECUTION_ADAPTERS.includes(executionAdapter)) errors.push(`execution must be one of ${EXECUTION_ADAPTERS.join(', ')}`);
  if (executionAdapter === 'command' && !command) errors.push('command is required when execution is command');
  if (errors.length) throw new ValidationError(errors);
  writeYaml(configFile, {
    schema_version: '1.1',
    baseline,
    decision_records: decisionRecords,
    work_items: workItems,
    run_root: runRoot,
    intake: { adapter: intakeAdapter, taskmaster: { tasks: DEFAULT_TASKMASTER_TASKS, tag: null } },
    execution: { adapter: executionAdapter, command, plan_dir: DEFAULT_PLAN_DIR },
    verification: {
      test_globs: testGlobsArg ? splitList(testGlobsArg) : [],
      id_pattern: null,
      test_command: null,
    },
  });
  const created = [DEFAULT_CONFIG];
  const workItemsFile = path.join(projectRoot, workItems);
  if (!fs.existsSync(workItemsFile)) {
    writeYaml(workItemsFile, { schema_version: '1.0', items: [] });
    created.push(workItems);
  }
  if (decisionRecords && !fs.existsSync(path.join(projectRoot, decisionRecords))) {
    fs.mkdirSync(path.join(projectRoot, decisionRecords), { recursive: true });
    created.push(`${decisionRecords}/`);
  }
  console.log(YAML.stringify({ created }, { lineWidth: 0 }));
}

export { loadConfig, initCommand, DEFAULT_CONFIG, DEFAULT_RUN_ROOT, INTAKE_ADAPTERS, EXECUTION_ADAPTERS };
