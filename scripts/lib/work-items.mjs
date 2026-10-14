import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { loadConfig } from './config.mjs';
import { ValidationError, asArray, optional, required } from './util.mjs';

const STATUSES = ['pending', 'in-progress', 'done', 'deferred'];
const ALLOWED_TRANSITIONS = { pending: ['in-progress', 'done'], 'in-progress': ['done'] };

function findItemNode(doc, taskId) {
  let sequence = doc.get('items');
  let node = null;
  for (const segment of String(taskId).split('.')) {
    node = null;
    for (const candidate of sequence?.items ?? []) {
      if (YAML.isMap(candidate) && String(candidate.get('id')) === segment) {
        node = candidate;
        break;
      }
    }
    if (!node) return null;
    sequence = node.get('subtasks');
  }
  return node;
}

function setStatus({ workItemsFile, taskId, status }) {
  if (!STATUSES.includes(status)) throw new ValidationError([`${taskId}: unknown status ${status}`]);
  const text = fs.readFileSync(workItemsFile, 'utf8');
  const doc = YAML.parseDocument(text);
  const node = YAML.isSeq(doc.get('items')) ? findItemNode(doc, taskId) : null;
  if (!node) throw new ValidationError([`work item ${taskId} not found`]);
  // A missing status means pending, matching the normalizer's default.
  const from = node.has('status') ? String(node.get('status')) : 'pending';
  if (from === status) return { task_id: taskId, from, to: status };
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(status)) {
    throw new ValidationError([`${taskId}: status transition ${from} -> ${status} is not allowed`]);
  }
  const next = editStatusText(text, doc, node, status);
  // The edit is textual; read it back so a file the splice cannot handle is never written half-changed.
  const check = findItemNode(YAML.parseDocument(next), taskId);
  if (!check || String(check.get('status')) !== status) {
    throw new ValidationError([`${taskId}: could not update the status line without rewriting the file`]);
  }
  fs.writeFileSync(workItemsFile, next);
  return { task_id: taskId, from, to: status };
}

/// Change only the status text so the rest of a hand-written file (folded text, flow lists, quotes,
/// comments) stays byte-identical. Re-serializing the document would reflow every item.
function editStatusText(text, doc, node, status) {
  const current = node.get('status', true);
  if (YAML.isScalar(current) && current.range) {
    const [start, end] = current.range;
    return text.slice(0, start) + status + text.slice(end);
  }
  const idPair = node.items.find((pair) => YAML.isScalar(pair.key) && pair.key.value === 'id');
  if (node.flow || !idPair?.key?.range || !idPair.value?.range) {
    // Flow-style items have no line of their own to insert into; fall back to re-serializing.
    node.set('status', status);
    return doc.toString({ lineWidth: 0 });
  }
  const keyStart = idPair.key.range[0];
  const column = keyStart - (text.lastIndexOf('\n', keyStart - 1) + 1);
  const lineEnd = text.indexOf('\n', idPair.value.range[1]);
  const at = lineEnd === -1 ? text.length : lineEnd;
  return `${text.slice(0, at)}\n${' '.repeat(column)}status: ${status}${text.slice(at)}`;
}

function definitionalFields(item) {
  const scalar = (value) => (value === undefined ? null : value);
  const list = (value) => [...asArray(value)].sort();
  return {
    title: scalar(item?.title),
    description: scalar(item?.description),
    details: scalar(item?.details),
    test_strategy: scalar(item?.test_strategy),
    dependencies: list(item?.dependencies),
    source_refs: list(item?.source_refs),
    acceptance_refs: list(item?.acceptance_refs),
  };
}

function setStatusCommand(args) {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot, optional(args, 'config'));
  const result = setStatus({
    projectRoot,
    workItemsFile: path.resolve(projectRoot, config.work_items),
    taskId: required(args, 'task'),
    status: required(args, 'status'),
  });
  process.stdout.write(YAML.stringify(result, { lineWidth: 0 }));
}

export { setStatus, definitionalFields, setStatusCommand, ALLOWED_TRANSITIONS };
