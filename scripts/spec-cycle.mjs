#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

const MISSING_DEPENDENCY_MESSAGE =
  'spec-cycle: bundled node_modules are missing from this plugin install; reinstall the plugin or run npm install in the plugin directory';

let core;
let detectModule;
let workItemsModule;
try {
  core = await import('./lib/core.mjs');
  detectModule = await import('./lib/detect.mjs');
  workItemsModule = await import('./lib/work-items.mjs');
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
  spec-cycle.mjs set-status --task <id> --status <status> [--config <file>]
  spec-cycle.mjs normalize --out <file> [--config <file>] [--task <id>]
  spec-cycle.mjs fingerprint (--file <file>|--manifest <author-manifest>)
  spec-cycle.mjs validate-author --manifest <file>
  spec-cycle.mjs validate-critic --report <file> --manifest <file>
  spec-cycle.mjs validate-decisions --decision-log <file> --manifest <file>
  spec-cycle.mjs build-handoff --manifest <file> --report <file> --out <file> [--decision-log <file>]
  spec-cycle.mjs validate-fixtures --root <directory>
  spec-cycle.mjs metrics --root <directory> [--out <file>]`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'init':
      initCommand(args);
      break;
    case 'detect':
      detectModule.detectCommand(args);
      break;
    case 'set-status':
      workItemsModule.setStatusCommand(args);
      break;
    case 'resolve-inputs':
      resolveInputsCommand(args);
      break;
    case 'normalize':
      normalizeCommand(args);
      break;
    case 'fingerprint':
      if (optional(args, 'manifest')) console.log(authorReviewFingerprint(path.resolve(args.manifest)));
      else console.log(sha256File(path.resolve(required(args, 'file'))));
      break;
    case 'validate-author':
      await validateAuthorFile(path.resolve(required(args, 'manifest')));
      console.log('author manifest valid');
      break;
    case 'validate-critic':
      await validateCriticFile(path.resolve(required(args, 'report')), path.resolve(required(args, 'manifest')));
      console.log('critic report valid');
      break;
    case 'validate-decisions':
      validateDecisionLogFile(path.resolve(required(args, 'decision-log')), path.resolve(required(args, 'manifest')));
      console.log('decision log valid');
      break;
    case 'build-handoff':
      await buildHandoff(args);
      break;
    case 'validate-fixtures':
      await validateFixtures(path.resolve(required(args, 'root')));
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
