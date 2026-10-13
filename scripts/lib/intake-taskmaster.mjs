import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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

function collectRefs(doc) {
  const refs = new Map();
  const walk = (sequence, parentId) => {
    for (const node of sequence?.items ?? []) {
      if (!YAML.isMap(node)) continue;
      const id = parentId === null ? String(node.get('id')) : `${parentId}.${node.get('id')}`;
      const ref = node.get('external_ref');
      if (typeof ref === 'string') refs.set(ref, { node, id });
      walk(node.get('subtasks'), id);
    }
  };
  walk(doc.get('items'), null);
  return refs;
}

function mergeInto(node, doc, { status, fields }, fullId, result, warnings) {
  for (const [key, value] of Object.entries(fields)) node.set(key, doc.createNode(value));
  const local = node.get('status');
  if (local !== status) {
    warnings.push(`${fullId}: Task Master status ${status} differs from local status ${local} (local kept)`);
  }
  result.updated.push(fullId);
}

function importTaskMaster({ projectRoot, tasksFile, tag, workItemsFile }) {
  const resolvedTag = resolveTag(projectRoot, tag);
  const tasks = selectTasks(readJson(tasksFile), resolvedTag, tasksFile);
  const result = { tag: resolvedTag, created: [], updated: [], deferred: [], warnings: [] };
  const { warnings } = result;

  const doc = fs.existsSync(workItemsFile)
    ? YAML.parseDocument(fs.readFileSync(workItemsFile, 'utf8'))
    : YAML.parseDocument('schema_version: "1.0"\nitems: []\n');
  if (!YAML.isSeq(doc.get('items'))) doc.set('items', doc.createNode([]));
  // An empty `items: []` is a flow sequence; appended maps must render as block YAML.
  if (doc.get('items').items.length === 0) doc.get('items').flow = false;
  const refs = collectRefs(doc);
  const seen = new Set();

  const place = (task, ref, label, fullId, parentSequence, newShape, mapDependency) => {
    seen.add(ref);
    const mapped = mapTask(task, label, warnings, mapDependency);
    const existing = refs.get(ref);
    if (existing) {
      mergeInto(existing.node, doc, mapped, fullId, result, warnings);
      return existing.node;
    }
    const node = doc.createNode({ ...newShape, ...mapped.fields, status: mapped.status, source_refs: [], acceptance_refs: [], external_ref: ref });
    parentSequence.add(node);
    result.created.push(fullId);
    return node;
  };

  for (const task of tasks) {
    const parentId = String(task.id);
    const fullId = workItemId(task.id);
    const node = place(task, externalRef(resolvedTag, parentId), parentId, fullId, doc.get('items'), { id: fullId }, dependencyId);
    if (!Array.isArray(task.subtasks) || task.subtasks.length === 0) continue;
    let subtasks = node.get('subtasks');
    if (!YAML.isSeq(subtasks)) {
      subtasks = doc.createNode([]);
      subtasks.flow = false;
      node.set('subtasks', subtasks);
    }
    for (const sub of task.subtasks) {
      const subId = `${parentId}.${sub.id}`;
      place(sub, externalRef(resolvedTag, subId), subId, `${fullId}.${sub.id}`, subtasks, { id: String(sub.id) }, subtaskDependencyId);
    }
  }

  const prefix = `taskmaster:${resolvedTag}:`;
  const note = removalNote(resolvedTag);
  for (const [ref, { node, id }] of refs) {
    if (!ref.startsWith(prefix) || seen.has(ref)) continue;
    const details = node.get('details');
    const text = typeof details === 'string' ? details : '';
    if (node.get('status') === 'deferred' && text.includes(note)) continue;
    node.set('status', 'deferred');
    if (!text.includes(note)) node.set('details', `${text}${text === '' ? '' : '\n\n'}${note}`);
    result.deferred.push(id);
  }

  fs.mkdirSync(path.dirname(workItemsFile), { recursive: true });
  fs.writeFileSync(workItemsFile, doc.toString({ lineWidth: 0 }));
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
