import path from "node:path";

const CASE_ID = /\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\]/g;
const IMPORT = /(?:\b(?:import|export)\b[^"']*?\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(\.[^"']+)\1/g;

export function discoverRegisteredIds(records, knownIds) {
  const ids = new Set();
  const source = records.map((record) => record.source).join("\n");
  for (const id of knownIds) if (source.includes(id)) ids.add(id);
  for (const match of source.matchAll(CASE_ID)) ids.add(match[1]);
  return ids;
}

export function inspectSourcePolicies(records, {
  machineHome = null,
  maxLines = 400,
  warningLines = 320,
} = {}) {
  const issues = [];
  for (const record of records) {
    const lines = record.source === "" ? 0
      : record.source.split(/\r?\n/).length - (/\r?\n$/.test(record.source) ? 1 : 0);
    if (lines > maxLines) {
      issues.push({ code: "line-limit", file: record.relative, severity: "error", value: lines });
    } else if (lines >= warningLines) {
      issues.push({ code: "line-warning", file: record.relative, severity: "warning", value: lines });
    }
    if (record.relative.startsWith("test/") && /\.(?:skip|only)\s*\(/.test(record.source)) {
      issues.push({ code: "test-escape-hatch", file: record.relative });
    }
    if (/sk-[A-Za-z0-9_-]{20,}/.test(record.source)) {
      issues.push({ code: "credential-like-token", file: record.relative });
    }
    if (machineHome && record.source.includes(machineHome)) {
      issues.push({ code: "machine-absolute-path", file: record.relative });
    }
  }
  return issues;
}

export function executorBindingIssues(executors, scripts) {
  const issues = [];
  for (const executor of executors) {
    const match = /^npm run ([a-z0-9:-]+)$/.exec(executor.command ?? "");
    if (!match || typeof scripts[match[1]] !== "string") {
      issues.push({ code: "executor-command", executor: executor.id });
    }
  }
  return issues;
}

function resolveImport(filename, request, known) {
  const base = path.resolve(path.dirname(filename), request);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

export function moduleCycles(records) {
  const known = new Set(records.map(({ filename }) => path.resolve(filename)));
  const graph = new Map(records.map(({ filename, source }) => {
    const imports = [];
    for (const match of source.matchAll(IMPORT)) {
      const target = resolveImport(filename, match[2], known);
      if (target) imports.push(target);
    }
    return [path.resolve(filename), imports];
  }));
  const cycles = [];
  const complete = new Set();
  const active = new Map();
  const visit = (node, stack) => {
    if (complete.has(node)) return;
    if (active.has(node)) {
      cycles.push([...stack.slice(active.get(node)), node]);
      return;
    }
    active.set(node, stack.length);
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next, stack);
    stack.pop();
    active.delete(node);
    complete.add(node);
  };
  for (const node of graph.keys()) visit(node, []);
  return cycles;
}
