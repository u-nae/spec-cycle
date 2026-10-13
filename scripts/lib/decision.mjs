import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  ValidationError, asArray, isObject, optional, readYaml, required, sha256File,
} from './util.mjs';

const MAX_CELLS = 10000;
const MISSING = '<missing>';
const SUPPORTED_HIT_POLICIES = ['UNIQUE', 'FIRST', 'ANY'];
const DEFAULT_RULE_ID = 'DEFAULT';

function obligationIdFor(taskId, decisionId, ruleId) {
  return `${taskId}-${decisionId}-${ruleId}`;
}

function emptyEvaluation(errors) {
  return { errors, cells_total: 0, rules: [], gaps: [], overlaps: [] };
}

function cellLabel(inputs) {
  return `{${Object.entries(inputs).map(([name, value]) => `${name}: ${value}`).join(', ')}}`;
}

function sameThen(left, right, outputNames) {
  return outputNames.every((name) => left[name] === right[name]);
}

// Validates declarations and normalizes every value to String(value).
function prepare(decision) {
  const errors = [];
  if (!isObject(decision)) return { errors: ['decision table must be an object'] };

  const inputs = asArray(decision.inputs).filter(isObject);
  const outputs = asArray(decision.outputs).filter(isObject);
  const rules = asArray(decision.rules).filter(isObject);
  if (inputs.length === 0) errors.push('inputs must be a non-empty list');
  if (outputs.length === 0) errors.push('outputs must be a non-empty list');
  if (rules.length === 0) errors.push('rules must be a non-empty list');

  const policy = decision.hit_policy;
  if (!SUPPORTED_HIT_POLICIES.includes(policy)) {
    errors.push(`hit_policy ${policy} is not supported by table-v1; use review-only`);
  } else if (policy === 'FIRST' && decision.ordered_rules !== true) {
    errors.push('ordered_rules must be true for FIRST');
  } else if (policy !== 'FIRST' && decision.ordered_rules !== false) {
    errors.push(`ordered_rules must be false for ${policy}`);
  }

  const inputDefs = inputs.map((input) => {
    const values = asArray(input.allowed_values).map(String);
    const blankMeans = input.blank_means === 'missing' ? 'missing' : 'any';
    if (values.length === 0) errors.push(`input ${input.name} has no allowed_values`);
    return {
      name: String(input.name),
      blankMeans,
      domain: blankMeans === 'missing' ? [...values, MISSING] : values,
      declared: new Set(values),
    };
  });
  const outputDefs = outputs.map((output) => ({
    name: String(output.name),
    declared: new Set(asArray(output.allowed_values).map(String)),
  }));
  const outputNames = outputDefs.map((output) => output.name);

  const checkThen = (label, then) => {
    const normalized = {};
    const source = isObject(then) ? then : {};
    for (const name of Object.keys(source)) {
      if (!outputNames.includes(name)) errors.push(`rule ${label} references unknown output ${name}`);
    }
    for (const output of outputDefs) {
      if (!(output.name in source)) {
        errors.push(`rule ${label} does not set output ${output.name}`);
        continue;
      }
      const value = String(source[output.name]);
      if (!output.declared.has(value)) errors.push(`rule ${label} output ${output.name} value ${value} is not in allowed_values`);
      normalized[output.name] = value;
    }
    return normalized;
  };

  const seen = new Set();
  const preparedRules = rules.map((rule) => {
    const ruleId = String(rule.rule_id);
    if (seen.has(ruleId)) errors.push(`duplicate rule_id ${ruleId}`);
    seen.add(ruleId);
    const when = isObject(rule.when) ? rule.when : {};
    for (const name of Object.keys(when)) {
      if (!inputDefs.some((input) => input.name === name)) errors.push(`rule ${ruleId} references unknown input ${name}`);
    }
    const matchSets = {};
    for (const input of inputDefs) {
      if (!(input.name in when)) {
        matchSets[input.name] = new Set(input.blankMeans === 'missing' ? [MISSING] : input.domain);
        continue;
      }
      const cell = when[input.name];
      if (cell === 'any') {
        matchSets[input.name] = new Set(input.domain);
        continue;
      }
      const literals = (Array.isArray(cell) ? cell : [cell]).map(String);
      for (const literal of literals) {
        if (!input.declared.has(literal)) errors.push(`rule ${ruleId} input ${input.name} value ${literal} is not in allowed_values`);
      }
      matchSets[input.name] = new Set(literals);
    }
    return { ruleId, matchSets, then: checkThen(ruleId, rule.then) };
  });

  let defaultThen = null;
  if (decision.default_rule !== null && decision.default_rule !== undefined) {
    defaultThen = checkThen(DEFAULT_RULE_ID, isObject(decision.default_rule) ? decision.default_rule.then : undefined);
  }

  return {
    errors, policy, inputDefs, outputNames, preparedRules, defaultThen,
    overlapAnalysis: asArray(decision.overlap_analysis),
  };
}

function evaluateTable(decision) {
  const prepared = prepare(decision);
  if (prepared.errors.length > 0) return emptyEvaluation(prepared.errors);
  const {
    policy, inputDefs, outputNames, preparedRules, defaultThen, overlapAnalysis,
  } = prepared;

  const cellsTotal = inputDefs.reduce((product, input) => product * input.domain.length, 1);
  if (cellsTotal > MAX_CELLS) {
    return emptyEvaluation([`cells_total ${cellsTotal} exceeds ${MAX_CELLS}; split the table`]);
  }

  const results = preparedRules.map((rule) => ({ rule_id: rule.ruleId, wins: [], shadowed: [] }));
  const defaultResult = defaultThen ? { rule_id: DEFAULT_RULE_ID, wins: [], shadowed: [] } : null;
  const errors = [];
  const gaps = [];
  const overlaps = [];

  const counters = inputDefs.map(() => 0);
  for (let cell = 0; cell < cellsTotal; cell += 1) {
    const inputs = {};
    inputDefs.forEach((input, index) => { inputs[input.name] = input.domain[counters[index]]; });

    const matching = [];
    preparedRules.forEach((rule, index) => {
      if (inputDefs.every((input) => rule.matchSets[input.name].has(inputs[input.name]))) matching.push(index);
    });

    if (matching.length === 0) {
      if (defaultResult) defaultResult.wins.push({ inputs, expected: { ...defaultThen } });
      else {
        gaps.push({ inputs });
        errors.push(`gap: ${cellLabel(inputs)}`);
      }
    } else if (matching.length === 1) {
      results[matching[0]].wins.push({ inputs, expected: { ...preparedRules[matching[0]].then } });
    } else {
      const ids = matching.map((index) => preparedRules[index].ruleId);
      const winnerIndex = matching[0];
      if (policy === 'UNIQUE') {
        overlaps.push({ inputs, rules: ids, winner: null });
        errors.push(`UNIQUE overlap: ${cellLabel(inputs)} matches ${ids.join(', ')}`);
      } else {
        if (policy === 'ANY') {
          const first = preparedRules[winnerIndex].then;
          if (!matching.every((index) => sameThen(first, preparedRules[index].then, outputNames))) {
            errors.push(`ANY overlap with different outputs: ${cellLabel(inputs)} ${ids.join(', ')}`);
          }
        }
        overlaps.push({ inputs, rules: ids, winner: ids[0] });
        results[winnerIndex].wins.push({ inputs, expected: { ...preparedRules[winnerIndex].then } });
        for (const index of matching.slice(1)) results[index].shadowed.push({ inputs, winner: ids[0] });
      }
    }

    for (let position = counters.length - 1; position >= 0; position -= 1) {
      counters[position] += 1;
      if (counters[position] < inputDefs[position].domain.length) break;
      counters[position] = 0;
    }
  }

  if (policy === 'FIRST' && overlaps.length > 0 && overlapAnalysis.length === 0) {
    errors.push('FIRST overlaps exist but overlap_analysis is empty');
  }
  if (defaultResult && defaultResult.wins.length === 0) errors.push('default_rule is unreachable');

  return {
    errors,
    cells_total: cellsTotal,
    rules: defaultResult ? [...results, defaultResult] : results,
    gaps,
    overlaps,
  };
}

function vectorsArtifact({ decision, tablePath, tableFingerprint, taskId }) {
  const evaluation = evaluateTable(decision);
  if (evaluation.errors.length > 0) throw new ValidationError(evaluation.errors);
  return {
    schema_version: '1.0',
    decision_id: decision.decision_id,
    table: tablePath,
    table_fingerprint: tableFingerprint,
    cells_total: evaluation.cells_total,
    rules: evaluation.rules.map((rule) => ({
      rule_id: rule.rule_id,
      obligation_id: obligationIdFor(taskId, decision.decision_id, rule.rule_id),
      wins: rule.wins,
      shadowed: rule.shadowed,
    })),
    gaps: evaluation.gaps,
    overlaps: evaluation.overlaps,
  };
}

function checkDecisionCommand(args) {
  const decision = readYaml(path.resolve(required(args, 'table')));
  const evaluation = evaluateTable(decision);
  process.stdout.write(YAML.stringify(evaluation, { lineWidth: 0 }));
  if (evaluation.errors.length > 0) throw new ValidationError(evaluation.errors);
}

function decisionVectorsCommand(args) {
  const tablePath = required(args, 'table');
  const out = path.resolve(required(args, 'out'));
  const table = path.resolve(tablePath);
  const decision = readYaml(table);
  const artifact = vectorsArtifact({
    decision,
    tablePath,
    tableFingerprint: sha256File(table),
    taskId: isObject(decision) ? decision.task_id : undefined,
  });
  const content = YAML.stringify(artifact, { lineWidth: 0 });
  if (fs.existsSync(out)) {
    if (fs.readFileSync(out, 'utf8') !== content) {
      throw new ValidationError([`Refusing to overwrite vectors that differ: ${optional(args, 'out')}`]);
    }
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
}

export {
  evaluateTable,
  vectorsArtifact,
  obligationIdFor,
  MAX_CELLS,
  MISSING,
  SUPPORTED_HIT_POLICIES,
  checkDecisionCommand,
  decisionVectorsCommand,
};
