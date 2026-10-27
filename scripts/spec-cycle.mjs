#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

const MISSING_DEPENDENCY_MESSAGE =
  'spec-cycle: bundled node_modules are missing from this plugin install; reinstall the plugin or run npm install in the plugin directory';

let core;
let detectModule;
let workItemsModule;
let intakeTaskMasterModule;
let decisionModule;
let handoffModule;
let briefModule;
let verifyModule;
let statusModule;
try {
  core = await import('./lib/core.mjs');
  detectModule = await import('./lib/detect.mjs');
  workItemsModule = await import('./lib/work-items.mjs');
  intakeTaskMasterModule = await import('./lib/intake-taskmaster.mjs');
  decisionModule = await import('./lib/decision.mjs');
  handoffModule = await import('./lib/handoff.mjs');
  briefModule = await import('./lib/brief.mjs');
  verifyModule = await import('./lib/verify.mjs');
  statusModule = await import('./lib/status.mjs');
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && /'(yaml|@cucumber[^']*)'/.test(error.message)) {
    console.error(MISSING_DEPENDENCY_MESSAGE);
    process.exit(1);
  }
  throw error;
}

const {
  ValidationError, parseArgs, required, optional, sha256File, authorReviewFingerprint,
  initCommand, resolveInputsCommand, normalizeCommand, validateAuthorFile, validateCriticFile,
  validateDecisionLogFile, buildHandoff, validateFixtures, metricsCommand,
} = core;

function usage() {
  console.log(`Usage:
  spec-cycle.mjs init (--baseline <doc>[,<doc>...] | --adopt <path>) [--decision-records <dir>] [--work-items <file>] [--run-root <dir>]
                      [--intake <native|taskmaster>] [--execution <superpowers|inline|command>] [--command <slash>]
                      [--test-globs <a,b>] [--project <dir>]
  spec-cycle.mjs detect [--project <dir>]
  spec-cycle.mjs resolve-inputs [--project <dir>] [--config <file>] [--task <id>]
  spec-cycle.mjs import-taskmaster [--tasks <file>] [--tag <name>] [--work-items <file>] [--config <file>]
  spec-cycle.mjs set-status --task <id> --status <status> [--config <file>]
  spec-cycle.mjs resolve-handoff --task <id> [--config <file>] [--project <dir>]
  spec-cycle.mjs verify-obligations --task <id> [--out <file>] [--test-command <cmd> --test-exit-code <n>] [--human-confirmed <true|false>] [--mark-done] [--config <file>]
  spec-cycle.mjs status [--json] [--write] [--config <file>]
  spec-cycle.mjs normalize --out <file> [--config <file>] [--task <id>]
  spec-cycle.mjs fingerprint (--file <file>|--manifest <author-manifest>)
  spec-cycle.mjs validate-author --manifest <file>
  spec-cycle.mjs validate-critic --report <file> --manifest <file>
  spec-cycle.mjs validate-decisions --decision-log <file> --manifest <file>
  spec-cycle.mjs build-handoff --manifest <file> --report <file> --out <file> [--decision-log <file>]
  spec-cycle.mjs validate-fixtures --root <directory>
  spec-cycle.mjs check-decision --table <file>
  spec-cycle.mjs decision-vectors --table <file> --out <file>
  spec-cycle.mjs render-brief --handoff <file> --out <file>
  spec-cycle.mjs check-plan --plan <file> --handoff <file>
  spec-cycle.mjs metrics --root <directory> [--out <file>]`);
}

// State-changing subcommands end by rewriting .spec-cycle/status.json (contracts.md "Status snapshot").
// Read-only ones (detect, resolve-handoff, fingerprint, check-*, status, validate-fixtures, metrics) do not.
function refresh(command, { projectRoot, configArg } = {}) {
  statusModule.refreshStatusSnapshot({ projectRoot, configArg, command });
}

function projectArg(args) {
  return path.resolve(optional(args, 'project') ?? process.cwd());
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'init':
      initCommand(args);
      refresh(command, { projectRoot: projectArg(args) });
      break;
    case 'detect':
      detectModule.detectCommand(args);
      break;
    case 'import-taskmaster':
      intakeTaskMasterModule.importTaskMasterCommand(args);
      refresh(command, { configArg: optional(args, 'config') });
      break;
    case 'set-status':
      workItemsModule.setStatusCommand(args);
      refresh(command, { configArg: optional(args, 'config') });
      break;
    case 'resolve-inputs':
      resolveInputsCommand(args);
      refresh(command, { projectRoot: projectArg(args), configArg: optional(args, 'config') });
      break;
    case 'resolve-handoff':
      handoffModule.resolveHandoffCommand(args);
      break;
    case 'verify-obligations':
      // The report is written before uncovered obligations fail the command, so the snapshot follows either way.
      try {
        verifyModule.verifyObligationsCommand(args);
      } finally {
        refresh(command, { configArg: optional(args, 'config') });
      }
      break;
    case 'status':
      statusModule.statusCommand(args);
      break;
    case 'normalize':
      normalizeCommand(args);
      refresh(command, { configArg: optional(args, 'config') });
      break;
    case 'fingerprint':
      if (optional(args, 'manifest')) console.log(authorReviewFingerprint(path.resolve(args.manifest)));
      else console.log(sha256File(path.resolve(required(args, 'file'))));
      break;
    case 'validate-author':
      await validateAuthorFile(path.resolve(required(args, 'manifest')));
      console.log('author manifest valid');
      refresh(command, { projectRoot: statusModule.projectRootForArtifact(args.manifest) });
      break;
    case 'validate-critic':
      await validateCriticFile(path.resolve(required(args, 'report')), path.resolve(required(args, 'manifest')));
      console.log('critic report valid');
      refresh(command, { projectRoot: statusModule.projectRootForArtifact(args.report) });
      break;
    case 'validate-decisions':
      validateDecisionLogFile(path.resolve(required(args, 'decision-log')), path.resolve(required(args, 'manifest')));
      console.log('decision log valid');
      refresh(command, { projectRoot: statusModule.projectRootForArtifact(args['decision-log']) });
      break;
    case 'build-handoff':
      await buildHandoff(args);
      refresh(command, { projectRoot: statusModule.projectRootForArtifact(required(args, 'out')) });
      break;
    case 'validate-fixtures':
      await validateFixtures(path.resolve(required(args, 'root')));
      break;
    case 'check-decision':
      decisionModule.checkDecisionCommand(args);
      break;
    case 'decision-vectors':
      decisionModule.decisionVectorsCommand(args);
      break;
    case 'render-brief':
      briefModule.renderBriefCommand(args);
      refresh(command, { projectRoot: statusModule.projectRootForArtifact(required(args, 'handoff')) });
      break;
    case 'check-plan':
      briefModule.checkPlanCommand(args);
      break;
    case 'metrics':
      await metricsCommand(args);
      break;
    default:
      usage();
      if (command) process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof ValidationError) {
    for (const item of error.errors) console.error(`- ${item}`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
