import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { loadConfig } from './config.mjs';
import { ValidationError, isObject, optional } from './util.mjs';

const STATUS_MAP = {
  pending: 'pending',
  'in-progress': 'in-progress',
  done: 'done',
  review: 'in-progress',
  deferred: 'deferred',
  cancelled: 'deferred',
};
const PRIORITIES = ['high', 'medium', 'low'];
const DEFAULT_TAG = 'master';

const externalRef = (tag, id) => `taskmaster:${tag}:${id}`;
const workItemId = (id) => `T${String(id)}`;
const dependencyId = (dep) => `T${String(dep)}`;
// A dotless subtask dependency is a sibling reference; the normalizer resolves it relative to the parent.
const subtaskDependencyId = (dep) => (String(dep).includes('.') ? dependencyId(dep) : String(dep));
const removalNote = (tag) => `Deferred: removed from Task Master tag ${tag} on import`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ValidationError([`cannot read Task Master file ${file}: ${error.message}`]);
  }
}

function resolveTag(projectRoot, tag) {
  if (tag) return tag;
  const state = path.join(projectRoot, '.taskmaster', 'state.json');
  if (fs.existsSync(state)) {
    try {
      const current = JSON.parse(fs.readFileSync(state, 'utf8'))?.currentTag;
      if (typeof current === 'string' && current) return current;
    } catch {
      // An unreadable state file falls back to the default tag.
    }
  }
  return DEFAULT_TAG;
}

function selectTasks(data, tag, file) {
  if (Array.isArray(data)) return data;
  if (!isObject(data)) throw new ValidationError([`${file}: unsupported Task Master format`]);
  if (Array.isArray(data.tasks)) return data.tasks;
  const available = Object.keys(data).filter((key) => isObject(data[key]) && Array.isArray(data[key].tasks)).sort();
  if (!available.includes(tag)) {
    throw new ValidationError([`tag ${tag} not found; available: ${available.join(', ')}`]);
  }
  return data[tag].tasks;
}

function mapTask(task, label, warnings, mapDependency) {
  let status = STATUS_MAP[task.status ?? 'pending'];
  if (status === undefined) {
    warnings.push(`task ${label}: unknown status ${task.status} mapped to pending`);
    status = 'pending';
  }
  let priority = task.priority ?? 'medium';
  if (!PRIORITIES.includes(priority)) {
    warnings.push(`task ${label}: unknown priority ${task.priority} mapped to medium`);
    priority = 'medium';
  }
  let details = task.details ?? '';
  const criteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.map(String) : [];
  if (criteria.length > 0) {
    details += `${details === '' ? '' : '\n\n'}Acceptance criteria (Task Master):\n${criteria.map((item) => `- ${item}`).join('\n')}`;
  }
  return {
    status,
    fields: {
      title: task.title ?? '',
      description: task.description ?? '',
      details,
      test_strategy: task.testStrategy ?? '',
      priority,
      dependencies: (task.dependencies ?? []).map(mapDependency),
    },
  };
}

/// Each entry also records its top-level item, the unit that is re-rendered when anything inside it changes.
function collectRefs(doc) {
  const refs = new Map();
  const walk = (sequence, parentId, top) => {
    for (const node of sequence?.items ?? []) {
      if (!YAML.isMap(node)) continue;
      const id = parentId === null ? String(node.get('id')) : `${parentId}.${node.get('id')}`;
      const owner = top ?? node;
      const ref = node.get('external_ref');
      if (typeof ref === 'string') refs.set(ref, { node, id, top: owner });
      walk(node.get('subtasks'), id, owner);
    }
  };
  walk(doc.get('items'), null, null);
  return refs;
}

/// Set only the fields whose value differs, so an unchanged field keeps its node (and its formatting).
/// Returns whether anything changed.
function mergeInto(node, doc, { status, fields }, fullId, result, warnings) {
  let changed = false;
  for (const [key, value] of Object.entries(fields)) {
    const current = node.get(key, true);
    const currentValue = YAML.isNode(current) ? current.toJSON() : current;
    if (node.has(key) && isDeepStrictEqual(currentValue, value)) continue;
    node.set(key, doc.createNode(value));
    changed = true;
  }
  const local = node.get('status');
  if (local !== status) {
    warnings.push(`${fullId}: Task Master status ${status} differs from local status ${local} (local kept)`);
  }
  result.updated.push(fullId);
  return changed;
}

function columnOf(text, offset) {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1);
}

function indentLines(rendered, column, { skipFirst = false } = {}) {
  const pad = ' '.repeat(column);
  return rendered.split('\n').map((line, index) => ((skipFirst && index === 0) || line === '' ? line : pad + line)).join('\n');
}

function renderNode(node) {
  const holder = new YAML.Document();
  holder.contents = node;
  return holder.toString({ lineWidth: 0 });
}

/// Write back only what the import changed: dirty top-level items are re-rendered in place, new items are
/// appended after the last item, and every other byte of a hand-written file stays as it was. Returns null
/// when the original layout gives no safe place to splice, so the caller re-serializes the document.
function spliceItems(text, sequence, dirty, appended) {
  const existing = sequence.items.filter((node) => !appended.includes(node));
  if (sequence.flow || existing.length === 0) return null;
  if (!existing.every((node) => YAML.isMap(node) && !node.flow && node.range)) return null;
  const first = existing[0].range[0];
  const dash = text.lastIndexOf('-', first - 1);
  if (dash < 0 || text.slice(dash + 1, first).trim() !== '' || columnOf(text, dash) > columnOf(text, first)) return null;

  let out = '';
  let cursor = 0;
  for (const node of existing) {
    if (!dirty.has(node)) continue;
    const [start, end] = node.range;
    // The comment before an item sits outside its range and is kept as text, so do not render it twice.
    const commentBefore = node.commentBefore;
    node.commentBefore = undefined;
    let rendered = renderNode(node);
    node.commentBefore = commentBefore;
    if (!text.slice(start, end).endsWith('\n')) rendered = rendered.replace(/\n$/, '');
    out += text.slice(cursor, start) + indentLines(rendered, columnOf(text, start), { skipFirst: true });
    cursor = end;
  }
  const insertAt = existing.at(-1).range[1];
  if (appended.length === 0) return out + text.slice(cursor);
  const tail = new YAML.YAMLSeq();
  tail.items = appended;
  const block = indentLines(renderNode(tail), columnOf(text, dash));
  out += text.slice(cursor, insertAt);
  if (!out.endsWith('\n')) out += '\n';
  return out + block + text.slice(insertAt);
}

function importTaskMaster({ projectRoot, tasksFile, tag, workItemsFile }) {
  const resolvedTag = resolveTag(projectRoot, tag);
  const tasks = selectTasks(readJson(tasksFile), resolvedTag, tasksFile);
  const result = { tag: resolvedTag, created: [], updated: [], deferred: [], warnings: [] };
  const { warnings } = result;

  const original = fs.existsSync(workItemsFile) ? fs.readFileSync(workItemsFile, 'utf8') : null;
  const doc = YAML.parseDocument(original ?? 'schema_version: "1.0"\nitems: []\n');
  const spliceable = original !== null && YAML.isSeq(doc.get('items'));
  if (!YAML.isSeq(doc.get('items'))) doc.set('items', doc.createNode([]));
  // An empty `items: []` is a flow sequence; appended maps must render as block YAML.
  if (doc.get('items').items.length === 0) doc.get('items').flow = false;
  const refs = collectRefs(doc);
  const seen = new Set();
  // Top-level items that existed before and changed, and top-level items this import adds.
  const dirty = new Set();
  const appended = [];

  const place = (task, ref, label, fullId, parentSequence, newShape, mapDependency, top) => {
    seen.add(ref);
    const mapped = mapTask(task, label, warnings, mapDependency);
    const existing = refs.get(ref);
    if (existing) {
      if (mergeInto(existing.node, doc, mapped, fullId, result, warnings)) dirty.add(existing.top);
      return existing.node;
    }
    const node = doc.createNode({ ...newShape, ...mapped.fields, status: mapped.status, source_refs: [], acceptance_refs: [], external_ref: ref });
    parentSequence.add(node);
    result.created.push(fullId);
    if (top === null) appended.push(node);
    else dirty.add(top);
    return node;
  };

  for (const task of tasks) {
    const parentId = String(task.id);
    const fullId = workItemId(task.id);
    const node = place(task, externalRef(resolvedTag, parentId), parentId, fullId, doc.get('items'), { id: fullId }, dependencyId, null);
    if (!Array.isArray(task.subtasks) || task.subtasks.length === 0) continue;
    let subtasks = node.get('subtasks');
    if (!YAML.isSeq(subtasks)) {
      subtasks = doc.createNode([]);
      subtasks.flow = false;
      node.set('subtasks', subtasks);
    }
    for (const sub of task.subtasks) {
      const subId = `${parentId}.${sub.id}`;
      place(sub, externalRef(resolvedTag, subId), subId, `${fullId}.${sub.id}`, subtasks, { id: String(sub.id) }, subtaskDependencyId, node);
    }
  }
  // A new top-level item is rendered whole when appended, so its own subtasks need no separate marking.
  for (const node of appended) dirty.delete(node);

  const prefix = `taskmaster:${resolvedTag}:`;
  const note = removalNote(resolvedTag);
  for (const [ref, { node, id, top }] of refs) {
    if (!ref.startsWith(prefix) || seen.has(ref)) continue;
    const details = node.get('details');
    const text = typeof details === 'string' ? details : '';
    if (node.get('status') === 'deferred' && text.includes(note)) continue;
    node.set('status', 'deferred');
    if (!text.includes(note)) node.set('details', `${text}${text === '' ? '' : '\n\n'}${note}`);
    result.deferred.push(id);
    dirty.add(top);
  }

  fs.mkdirSync(path.dirname(workItemsFile), { recursive: true });
  let next = spliceable ? spliceItems(original, doc.get('items'), dirty, appended) : null;
  // The splice is textual; read it back and re-serialize instead if it does not yield the merged document.
  if (next !== null && !isDeepStrictEqual(YAML.parse(next), doc.toJSON())) {
    warnings.push(`${path.basename(workItemsFile)}: could not keep the existing layout; the file was re-serialized`);
    next = null;
  }
  next ??= doc.toString({ lineWidth: 0 });
  if (next !== original) fs.writeFileSync(workItemsFile, next);
  return result;
}

function importTaskMasterCommand(args) {
  const projectRoot = process.cwd();
  const config = loadConfig(projectRoot, optional(args, 'config'));
  const result = importTaskMaster({
    projectRoot,
    tasksFile: path.resolve(projectRoot, optional(args, 'tasks') ?? config.intake.taskmaster.tasks),
    tag: optional(args, 'tag') ?? config.intake.taskmaster.tag,
    workItemsFile: path.resolve(projectRoot, optional(args, 'work-items') ?? config.work_items),
  });
  process.stdout.write(YAML.stringify(result, { lineWidth: 0 }));
}

export { importTaskMaster, importTaskMasterCommand, externalRef, workItemId, STATUS_MAP };
