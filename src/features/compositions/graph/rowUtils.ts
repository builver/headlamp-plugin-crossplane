import { AstCall, CelNode, celNodeToCelInner, parseCelAst } from './celAst';
import { celInterpRe, extractGroup, isSimplePath, parseSegments } from './celUtils';
import { refToNodeId, VAR_FIELD_PREFIX } from './constants';
import { EXPR_NODE_DEFS } from './exprGraph/ExprNodeDefs';
import { deleteDeepPath, getDeepPath, setDeepPath } from './pathUtils';
import { qualifiedPath, SECTION_DEFS, sectionOf, sectionRelPath } from './sectionDefs';
import { ExtraEdge, FieldEdit, FieldSuggestion, OpNode, OutPort, RowSegment, TRow } from './types';

// ── Scalar CEL value classifier ────────────────────────────────────────────────

const BARE_VAR_RE = /^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/;

/** Classifies a scalar string value into one of the TRow CEL display modes. */
function parseScalarCelValue(
  val: string,
  knownIds: Set<string>,
): Pick<TRow, 'inPort' | 'segments' | 'celExpr' | 'value'> {
  const CEL_RE = celInterpRe();
  const matches: RegExpExecArray[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = CEL_RE.exec(val)) !== null) {
    if (knownIds.has(mm[1])) matches.push(mm);
  }
  if (matches.length === 1 && val.trim() === matches[0][0] && isSimplePath(matches[0][2])) {
    const srcPath = matches[0][2];
    const optional = srcPath.includes('?');
    const srcShort = srcPath.replace(/\?/g, '').split('.').pop() ?? srcPath.replace(/\?/g, '');
    return { inPort: { ref: matches[0][1], srcPath, srcShort, optional } };
  } else if (matches.length > 0) {
    return { segments: parseSegments(val, knownIds) };
  }
  const bareM = BARE_VAR_RE.exec(val);
  if (bareM && knownIds.has(bareM[1])) {
    return { inPort: { ref: bareM[1], srcPath: '', srcShort: bareM[1], optional: false } };
  } else if (/^\$\{(true|false|null|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\}$/.test(val)) {
    return { value: val };
  } else if (/\$\{/.test(val)) {
    return { celExpr: val };
  }
  return { value: val };
}

// ── TRow factory helpers ───────────────────────────────────────────────────────

/** Leaf row. String values are auto-classified via parseScalarCelValue. */
export function makeLeafRow(
  depth: number, key: string, fieldPath: string,
  val: unknown, knownIds: Set<string>,
  extra?: Partial<TRow>,
): TRow {
  const cel = typeof val === 'string' ? parseScalarCelValue(val, knownIds) : {};
  const value = (typeof val !== 'string' && val !== null && val !== undefined)
    ? (Array.isArray(val) ? `[${(val as unknown[]).length}]` : String(val))
    : undefined;
  return { depth, key, isParent: false, fieldPath, ...(value !== undefined ? { value } : {}), ...cel, ...extra };
}

/** Parent (container) row. */
export function makeParentRow(
  depth: number, key: string, fieldPath: string,
  extra?: Partial<TRow>,
): TRow {
  return { depth, key, isParent: true, fieldPath, ...extra };
}

// ── Template row builder ───────────────────────────────────────────────────────

export function buildTemplateRows(
  obj: unknown, knownIds: Set<string>, outPortPaths: Set<string>,
  visitedOutPorts: Set<string>, depth = 0, pathSoFar = '',
): TRow[] {
  const rows: TRow[] = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return rows;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = pathSoFar ? `${pathSoFar}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const children = buildTemplateRows(val, knownIds, outPortPaths, visitedOutPorts, depth + 1, path);
      if (children.length > 0) { rows.push(makeParentRow(depth, key, path)); rows.push(...children); }
    } else if (Array.isArray(val) && val.length > 0) {
      // Array — expand into indexed item rows
      rows.push(makeParentRow(depth, key, path, { isArrayParent: true }));
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        const itemPath = `${path}.${i}`;
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          rows.push(makeParentRow(depth + 1, String(i), itemPath));
          const children = buildTemplateRows(item, knownIds, outPortPaths, visitedOutPorts, depth + 2, itemPath);
          rows.push(...children);
        } else if (item !== null && item !== undefined) {
          rows.push(makeLeafRow(depth + 1, String(i), itemPath, item, knownIds));
        }
      }
    } else {
      const isOut = outPortPaths.has(path);
      if (isOut) visitedOutPorts.add(path);
      const outPort = isOut ? { path, short: key } : undefined;
      if (val !== null && val !== undefined) {
        rows.push(makeLeafRow(depth, key, path, val, knownIds, { outPort }));
      }
    }
  }
  return rows;
}

// ── Output port row builder ────────────────────────────────────────────────────

/**
 * Returns the index before which to insert a new block, based on alphabetical order of the
 * first path segment across all existing rows.
 *
 * Invariant: every row in the arrays processed here has `fieldPath` set — all rows are
 * produced by `buildTemplateRows` / `insertRowAtPath`, both of which always set it.
 * Rows whose `fieldPath` is absent are skipped by the `seg &&` guard; if such a row were
 * ever positioned mid-list it would cause incorrect insertion, but this never happens today.
 */
export function findAlphaInsertBefore(rows: TRow[], firstSeg: string): number {
  for (let i = 0; i < rows.length; i++) {
    const seg = rows[i].fieldPath?.split('.')[0];
    if (seg && seg > firstSeg) return i;
  }
  return rows.length;
}

// ── Row insertion helpers ──────────────────────────────────────────────────────

/**
 * Shared logic for inserting a row at the correct hierarchical position.
 * Missing ancestor parent rows are injected as needed.
 */
export function insertRowAtPath(
  rows: TRow[], fieldPath: string,
  leafExtra: Partial<TRow>, ghostParent = false,
): TRow[] {
  const parts     = fieldPath.split('.');
  const leafKey   = parts[parts.length - 1];
  const leafDepth = parts.length - 1;

  if (rows.some(r => r.fieldPath === fieldPath)) return rows;

  let insertAfterIdx = -1;
  let ancestorFound = false;
  for (let d = parts.length - 2; d >= 0; d--) {
    const ancestorPath = parts.slice(0, d + 1).join('.');
    let found = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.fieldPath === ancestorPath || r.fieldPath?.startsWith(ancestorPath + '.')) found = i;
    }
    if (found >= 0) { insertAfterIdx = found; ancestorFound = true; break; }
  }
  if (!ancestorFound) {
    // No ancestor in rows — insert alphabetically by first path segment.
    insertAfterIdx = findAlphaInsertBefore(rows, parts[0]) - 1;
  }

  const toInsert: TRow[] = [];
  for (let d = 0; d < parts.length - 1; d++) {
    const pKey       = parts[d];
    const parentPath = parts.slice(0, d + 1).join('.');
    if (!rows.some(r => r.fieldPath === parentPath)) {
      toInsert.push(makeParentRow(d, pKey, parentPath, ghostParent ? { isGhost: true } : undefined));
    }
  }
  toInsert.push({ depth: leafDepth, key: leafKey, isParent: false, fieldPath, ...leafExtra });

  const result = [...rows];
  result.splice(insertAfterIdx + 1, 0, ...toInsert);
  return result;
}


// ── Ghost field merging ────────────────────────────────────────────────────────

export function insertGhostRow(rows: TRow[], fieldPath: string, fieldType: string): TRow[] {
  return insertRowAtPath(rows, fieldPath, { isGhost: true, ghostType: fieldType }, true);
}

/**
 * Returns `rows` with all `potFields` inserted as ghost rows.
 *
 * `potFields` is sorted by full path before iteration so that within each top-level
 * group (e.g. `metadata.*`) siblings accumulate in alphabetical order: `insertRowAtPath`
 * appends new siblings after the last existing sibling in the subtree, so the final order
 * within a group reflects the iteration order.
 */
export function mergeWithGhostFields(rows: TRow[], potFields: FieldSuggestion[]): TRow[] {
  const sorted = [...potFields].sort((a, b) => a.path.localeCompare(b.path));
  let merged = rows;
  for (const pf of sorted) {
    merged = insertGhostRow(merged, pf.path, pf.type);
  }
  return merged;
}

// ── Patch helpers ─────────────────────────────────────────────────────────────

/** Reads a nested value from obj at the given dot-separated path. */

/** After deleting a leaf, walks back up and removes any ancestor objects that became empty. */
function pruneEmptyAncestors(obj: any, dotPath: string): void {
  const parts = dotPath.split('.');
  for (let len = parts.length - 1; len >= 1; len--) {
    const parentPath = parts.slice(0, len).join('.');
    const val = getDeepPath(obj, parentPath);
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && Object.keys(val as object).length === 0) {
      deleteDeepPath(obj, parentPath);
    } else {
      break;
    }
  }
}

/**
 * Recursively builds a CEL expression string by traversing op nodes.
 * If srcNodeId is a regular node, returns `ref.fieldPath`.
 * If srcNodeId is an op node, recursively resolves its inputs and calls toCel.
 */
export function buildCelFromChain(
  srcNodeId: string, srcFieldPath: string,
  extraEdges: ExtraEdge[], opNodes: OpNode[],
): string {
  const opNode = opNodes.find(n => n.id === srcNodeId);
  if (!opNode) {
    return SECTION_DEFS[sectionOf(srcFieldPath)].celRef(srcNodeId, sectionRelPath(srcFieldPath));
  }
  // var:fieldPath — reference to the lambda variable's sub-field
  if (srcFieldPath.startsWith(VAR_FIELD_PREFIX)) {
    const varName = opNode.literals['var'] ?? 'x';
    return `${varName}.${srcFieldPath.slice(VAR_FIELD_PREFIX.length)}`;
  }
  if (opNode.category === 'raw-template') {
    return opNode.literals['value'] ?? '';
  }
  const def = EXPR_NODE_DEFS[opNode.category];
  if (!def) return srcFieldPath;
  const ports = def.variadic
    ? Array.from({ length: opNode.portCount ?? def.inputs.length }, (_, i) => def.inputs[0] ? { ...def.inputs[0], name: String.fromCharCode(65 + i) } : { name: String.fromCharCode(65 + i), label: String.fromCharCode(65 + i), type: 'string' })
    : def.inputs;
  const inputs: Record<string, string> = {};
  for (const port of ports) {
    const edge = extraEdges.find(e => e.tgtNodeId === opNode.id && e.tgtFieldPath === port.name);
    if (edge) {
      inputs[port.name] = buildCelFromChain(edge.srcNodeId, edge.srcFieldPath, extraEdges, opNodes);
    } else {
      const raw = opNode.literals[port.name] ?? '';
      // String-typed ports require CEL string literals — wrap in quotes automatically.
      inputs[port.name] = port.type === 'string' ? `"${raw}"` : raw;
    }
  }
  return def.toCel(opNode.op, inputs);
}

/**
 * Returns a deep clone of `input` with each ExtraEdge applied as a CEL expression
 * on the target resource's template field. Op node edges are traversed recursively.
 */
export function applyExtraEdgesToInput(input: any, extraEdges: ExtraEdge[], opNodes: OpNode[] = []): any {
  const clone = JSON.parse(JSON.stringify(input));
  const opNodeMap = new Map(opNodes.map(n => [n.id, n]));
  const opNodeIds = new Set(opNodeMap.keys());
  for (const edge of extraEdges) {
    if (opNodeIds.has(edge.tgtNodeId)) continue; // intermediate op-node edges; captured by traversal
    const celContent = buildCelFromChain(edge.srcNodeId, edge.srcFieldPath, extraEdges, opNodes);
    // raw-template nodes return the full template string verbatim (already contains ${...})
    const isRawTemplate = opNodeMap.get(edge.srcNodeId)?.category === 'raw-template';
    const celExpr = isRawTemplate ? celContent : `\${${celContent}}`;
    const tgtRes = (clone.resources ?? []).find((r: any) => r.id === edge.tgtNodeId);
    if (!tgtRes) continue;
    SECTION_DEFS[sectionOf(edge.tgtFieldPath)].applyEdge(tgtRes, sectionRelPath(edge.tgtFieldPath), celExpr);
  }
  return clone;
}

/** Deep-clone `input` and apply field template edits. Empty template means delete the field. */
export function applyFieldEditsToInput(input: any, fieldEdits: FieldEdit[]): any {
  const clone = JSON.parse(JSON.stringify(input));
  for (const edit of fieldEdits) {
    const tgtRes = (clone.resources ?? []).find((r: any) => r.id === edit.nodeId);
    if (!tgtRes) continue;
    const sec = sectionOf(edit.fieldPath);
    if (sec !== 'template') {
      // Non-template sections: simple write (no delete support for these sections).
      if (edit.template !== '') {
        SECTION_DEFS[sec].applyEdge(tgtRes, sectionRelPath(edit.fieldPath), edit.template);
      }
      continue;
    }
    // Template section: support delete + externalRef writes.
    const relPath = edit.fieldPath; // template section: relPath === fieldPath (no prefix)
    const isExtRef = tgtRes.externalRef !== undefined && tgtRes.template === undefined;
    if (edit.template === '') {
      if (tgtRes.template) { deleteDeepPath(tgtRes.template, relPath); pruneEmptyAncestors(tgtRes.template, relPath); }
      if (isExtRef) { deleteDeepPath(tgtRes.externalRef, relPath); pruneEmptyAncestors(tgtRes.externalRef, relPath); }
    } else if (isExtRef) {
      setDeepPath(tgtRes.externalRef, relPath, edit.template);
    } else {
      SECTION_DEFS.template.applyEdge(tgtRes, relPath, edit.template);
    }
  }
  return clone;
}

/**
 * Given a deleted array-item path (last segment is a digit), remap a sibling path
 * so that items with a higher index are decremented by 1.  Returns `p` unchanged
 * if the deletion is not an array item or `p` is not an affected sibling.
 */
export function reindexPathAfterDelete(deletedPath: string, p: string): string {
  const segs = deletedPath.split('.');
  const lastSeg = segs[segs.length - 1];
  if (!/^\d+$/.test(lastSeg)) return p;
  const deletedIdx = parseInt(lastSeg, 10);
  const parentPrefix = segs.slice(0, -1).join('.') + '.';
  if (!p.startsWith(parentPrefix)) return p;
  const rest = p.slice(parentPrefix.length);
  const dotIdx = rest.indexOf('.');
  const firstSeg = dotIdx === -1 ? rest : rest.slice(0, dotIdx);
  const tail = dotIdx === -1 ? '' : rest.slice(dotIdx);
  const sibIdx = parseInt(firstSeg, 10);
  if (isNaN(sibIdx) || sibIdx <= deletedIdx) return p;
  return parentPrefix + (sibIdx - 1) + tail;
}

/**
 * Remove a leaf row at `fieldPath` from `rows`, renumber any higher-indexed
 * siblings if the path is an array item, then prune any parent rows that become
 * childless (repeated until stable for nested empty parents).
 */
export function removeRowAtPath(rows: TRow[], fieldPath: string): TRow[] {
  // Remove target and all descendant rows (needed when deleting an array item parent)
  let result = rows.filter(r => r.fieldPath !== fieldPath && !r.fieldPath?.startsWith(fieldPath + '.'));
  // Renumber higher-indexed siblings in the same array
  result = result.map(r => {
    if (!r.fieldPath) return r;
    const newFp = reindexPathAfterDelete(fieldPath, r.fieldPath);
    if (newFp === r.fieldPath) return r;
    const newKey = newFp.split('.').pop()!;
    return { ...r, fieldPath: newFp, key: newKey };
  });
  let changed = true;
  while (changed) {
    changed = false;
    const next = result.filter(r => {
      if (!r.isParent || !r.fieldPath) return true;
      const fp = r.fieldPath;
      if (result.some(c => c.fieldPath !== fp && c.fieldPath?.startsWith(fp + '.'))) return true;
      changed = true;
      return false;
    });
    result = next;
  }
  return result;
}

// Keep OutPort exported for consumers that need it
export type { OutPort };

// ── forEach / includeWhen / readyWhen helpers ──────────────────────────────────

/** Normalizes a scalar string or array of strings into a string[]. */
function toConditionExprs(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  const s = String(val);
  return s ? [s] : [];
}

/** Returns the variable names declared in res.forEach entries. */
export function forEachVarNames(res: any): string[] {
  return (res?.forEach ?? []).flatMap((entry: any) => Object.keys(entry));
}

/** Base known set extended with 'each' and all forEach variable names for a resource. */
export function buildKnownForRes(res: any, baseKnown: Set<string>): Set<string> {
  const extras = forEachVarNames(res);
  if (!extras.length) return new Set([...baseKnown, 'each']);
  return new Set([...baseKnown, 'each', ...extras]);
}

/** Produce a single TRow for a scalar value from forEach / includeWhen / readyWhen. */
function parseSpecialFieldValue(
  val: unknown, key: string, fieldPath: string, knownIds: Set<string>,
): TRow {
  return makeLeafRow(1, key, fieldPath, val, knownIds);
}

/**
 * Build display rows for forEach / includeWhen / readyWhen sections.
 * Returns section-header rows followed by per-item rows for each present field.
 */
export function buildSpecialFieldRows(res: any, knownForRes: Set<string>): TRow[] {
  const rows: TRow[] = [];

  if (res.forEach?.length) {
    rows.push({ depth: 0, key: 'forEach', isParent: false, isSection: true, canImport: false, canExport: false });
    for (const entry of res.forEach) {
      for (const [varName, val] of Object.entries(entry as Record<string, unknown>)) {
        const fp = qualifiedPath('forEach', varName);
        rows.push({ ...parseSpecialFieldValue(val, varName, fp, knownForRes),
          canImport: true, canExport: true, outPort: { path: fp, short: varName } });
      }
    }
  }

  const includeWhenExprs = toConditionExprs(res.includeWhen);
  if (includeWhenExprs.length) {
    rows.push({ depth: 0, key: 'includeWhen', isParent: false, isSection: true, canImport: false, canExport: false });
    includeWhenExprs.forEach((expr, idx) => {
      const key = String(idx);
      rows.push({ ...parseSpecialFieldValue(expr, key, qualifiedPath('includeWhen', key), knownForRes),
        canImport: true, canExport: false });
    });
  }

  const readyWhenExprs = toConditionExprs(res.readyWhen);
  if (readyWhenExprs.length) {
    rows.push({ depth: 0, key: 'readyWhen', isParent: false, isSection: true, canImport: false, canExport: false });
    readyWhenExprs.forEach((expr, idx) => {
      const key = String(idx);
      rows.push({ ...parseSpecialFieldValue(expr, key, qualifiedPath('readyWhen', key), knownForRes),
        canImport: true, canExport: false });
    });
  }

  return rows;
}

/**
 * Replace 'each' and forEach variable name refs in rows with the resource's own node id,
 * producing self-loop port connections.
 */
export function postProcessEachRefs(rows: TRow[], eachNodeId: string, selfRefs: Set<string>): TRow[] {
  if (!selfRefs.size) return rows;
  return rows.map(row => {
    if (row.isSection) return row;
    if (row.inPort && selfRefs.has(row.inPort.ref)) {
      return { ...row, inPort: { ...row.inPort, ref: eachNodeId, origRef: row.inPort.ref } };
    }
    if (row.segments) {
      const newSegs = row.segments.map(seg =>
        seg.kind === 'cel' && seg.srcRef && selfRefs.has(seg.srcRef)
          ? { ...seg, srcRef: eachNodeId, srcNodeId: eachNodeId }
          : seg
      );
      if (newSegs.some((s, i) => s !== row.segments![i])) {
        return { ...row, segments: newSegs };
      }
    }
    return row;
  });
}

// ── CEL → Graph reconstruction ─────────────────────────────────────────────────

type ParsedOperand =
  | { kind: 'ref'; nodeId: string; fieldPath: string }
  | { kind: 'opNode'; id: string }
  | { kind: 'literal'; value: string };

function celBinaryOpToCategory(op: string): string | null {
  if (['==', '!=', '>', '<', '>=', '<='].includes(op)) return 'compare';
  if (op === '&&') return 'and';
  if (op === '||') return 'or';
  if (op === '+') return 'string-concat';
  return null;
}

function makeReconOpNode(
  category: string, op: string,
  inputsByPort: Record<string, ParsedOperand>,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): ParsedOperand {
  const id = `op-r-${counter.n++}`;
  const node: OpNode = { id, category, op, x: 900, y: 50 + out.opNodes.length * 80, literals: {} };
  out.opNodes.push(node);
  const def = EXPR_NODE_DEFS[category];
  for (const port of def.inputs) {
    const operand = inputsByPort[port.name];
    if (!operand) continue;
    if (operand.kind === 'literal') {
      node.literals[port.name] = operand.value;
    } else if (operand.kind === 'ref') {
      out.extraEdges.push({
        id: `ee-r-${counter.n++}`,
        srcNodeId: operand.nodeId, srcFieldPath: operand.fieldPath,
        tgtNodeId: id, tgtFieldPath: port.name,
      });
    } else {
      out.extraEdges.push({
        id: `ee-r-${counter.n++}`,
        srcNodeId: operand.id, srcFieldPath: 'output',
        tgtNodeId: id, tgtFieldPath: port.name,
      });
    }
  }
  return { kind: 'opNode', id };
}

/** Create a single variadic string-concat op node wiring all operands to ports A, B, C, … */
function makeConcatOpNode(
  operands: ParsedOperand[],
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): ParsedOperand {
  const id = `op-r-${counter.n++}`;
  const node: OpNode = {
    id, category: 'string-concat', op: '+',
    x: 900, y: 50 + out.opNodes.length * 80,
    literals: {}, portCount: operands.length,
  };
  out.opNodes.push(node);
  for (let i = 0; i < operands.length; i++) {
    const portName = String.fromCharCode(65 + i);
    const operand = operands[i];
    if (operand.kind === 'literal') {
      node.literals[portName] = operand.value;
    } else if (operand.kind === 'ref') {
      out.extraEdges.push({
        id: `ee-r-${counter.n++}`,
        srcNodeId: operand.nodeId, srcFieldPath: operand.fieldPath,
        tgtNodeId: id, tgtFieldPath: portName,
      });
    } else {
      out.extraEdges.push({
        id: `ee-r-${counter.n++}`,
        srcNodeId: operand.id, srcFieldPath: 'output',
        tgtNodeId: id, tgtFieldPath: portName,
      });
    }
  }
  return { kind: 'opNode', id };
}

function parseOperandStr(
  s: string, knownIds: Set<string>,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): ParsedOperand {
  const t = s.trim();
  const refM = /^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_.]*)$/.exec(t);
  if (refM && knownIds.has(refM[1])) {
    return { kind: 'ref', nodeId: refToNodeId(refM[1]), fieldPath: refM[2] };
  }
  if (t.startsWith('(')) {
    const grp = extractGroup(t, 0);
    if (grp && grp.end === t.length) {
      const result = parseParenInner(grp.inner, knownIds, out, counter);
      if (result) return result;
    }
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return { kind: 'literal', value: t.slice(1, -1) };
  }
  const ast = parseCelAst(t, knownIds);
  if (ast.kind === 'call' && (ast as AstCall).receiver !== null) {
    const parsed = parseAstCallOperand(ast as AstCall, out, counter, knownIds);
    if (parsed) return parsed;
  }
  if (ast.kind === 'ref' && knownIds.has(ast.nodeRef)) {
    return { kind: 'ref', nodeId: refToNodeId(ast.nodeRef), fieldPath: ast.fieldPath };
  }
  return { kind: 'literal', value: t };
}

/** Flattens a left-recursive chain of `+` binary CelNodes into a flat list of operands. */
function collectConcatCelNodes(node: CelNode): CelNode[] {
  if (node.kind === 'binary' && node.op === '+') {
    return [...collectConcatCelNodes(node.left), ...collectConcatCelNodes(node.right)];
  }
  return [node];
}

/**
 * Recursively converts a parsed CelNode AST into a ParsedOperand, creating op nodes as needed.
 * Uses the already-correct precedence from parseCelAst rather than text-based splitting.
 */
function celAstToParseOperand(
  node: CelNode,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
  knownIds?: Set<string>,
): ParsedOperand {
  switch (node.kind) {
    case 'ref':
      return { kind: 'ref', nodeId: refToNodeId(node.nodeRef), fieldPath: node.fieldPath };
    case 'literal':
      return { kind: 'literal', value: node.value };
    case 'binary': {
      if (node.op === '+') {
        const operands = collectConcatCelNodes(node).map(o => celAstToParseOperand(o, out, counter, knownIds));
        return makeConcatOpNode(operands, out, counter);
      }
      const category = celBinaryOpToCategory(node.op);
      if (!category) return { kind: 'literal', value: celNodeToCelInner(node) };
      return makeReconOpNode(category, node.op, {
        A: celAstToParseOperand(node.left, out, counter, knownIds),
        B: celAstToParseOperand(node.right, out, counter, knownIds),
      }, out, counter);
    }
    case 'unary':
      if (node.op === '!') {
        return makeReconOpNode('not', '!', {
          A: celAstToParseOperand(node.operand, out, counter, knownIds),
        }, out, counter);
      }
      return { kind: 'literal', value: celNodeToCelInner(node) };
    case 'ternary':
      return makeReconOpNode('conditional', '?:', {
        condition: celAstToParseOperand(node.cond, out, counter, knownIds),
        then: celAstToParseOperand(node.then_, out, counter, knownIds),
        else: celAstToParseOperand(node.else_, out, counter, knownIds),
      }, out, counter);
    case 'call':
      if (node.receiver !== null) {
        const parsed = parseAstCallOperand(node as AstCall, out, counter, knownIds);
        if (parsed) return parsed;
      }
      return { kind: 'literal', value: celNodeToCelInner(node) };
    case 'raw':
      return { kind: 'literal', value: node.text };
  }
}

function parseParenInner(
  inner: string, knownIds: Set<string>,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): ParsedOperand | null {
  const s = inner.trim();
  const ast = parseCelAst(s, knownIds);
  if (ast.kind === 'binary' || ast.kind === 'unary' || ast.kind === 'ternary') {
    return celAstToParseOperand(ast, out, counter, knownIds);
  }
  return null;
}

/** Create a raw-template op node that holds the complete template verbatim. */
function makeRawTemplateOpNode(
  template: string,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): ParsedOperand {
  const id = `op-r-${counter.n++}`;
  const node: OpNode = {
    id, category: 'raw-template', op: 'template',
    x: 900, y: 50 + out.opNodes.length * 80,
    literals: { value: template },
  };
  out.opNodes.push(node);
  return { kind: 'opNode', id };
}

/** Build a single variadic string-concat op node from parsed template segments. */
function buildSegmentConcatChain(
  segments: RowSegment[],
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): ParsedOperand | null {
  const segs = segments.filter(s => s.kind !== 'literal' || (s.text ?? '') !== '');
  if (!segs.length) return null;
  const operands: ParsedOperand[] = segs.map(seg =>
    seg.kind === 'cel'
      ? { kind: 'ref', nodeId: refToNodeId(seg.srcRef!), fieldPath: seg.srcPath! }
      : { kind: 'literal', value: seg.text ?? '' }
  );
  if (operands.length === 1) return operands[0];
  return makeConcatOpNode(operands, out, counter);
}

function astNodeToOperand(node: CelNode): ParsedOperand {
  if (node.kind === 'ref') return { kind: 'ref', nodeId: refToNodeId(node.nodeRef), fieldPath: node.fieldPath };
  if (node.kind === 'literal') return { kind: 'literal', value: node.value };
  return { kind: 'literal', value: celNodeToCelInner(node) };
}

/** Like astNodeToOperand but recursively parses chained method calls into op nodes. */
function astNodeToChainedOperand(
  node: CelNode,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
  knownIds?: Set<string>,
): ParsedOperand {
  if (node.kind === 'ref') return { kind: 'ref', nodeId: refToNodeId(node.nodeRef), fieldPath: node.fieldPath };
  if (node.kind === 'literal') return { kind: 'literal', value: node.value };
  if (node.kind === 'call' && node.receiver !== null) {
    const parsed = parseAstCallOperand(node as AstCall, out, counter, knownIds);
    if (parsed) return parsed;
  }
  return { kind: 'literal', value: celNodeToCelInner(node) };
}

/**
 * Reconstruct a predicate op (map/exists) with var context.
 * Re-parses the pred/expr argument with varName added to knownIds so that
 * `varName.field` patterns create graph edges instead of literals.
 * After parsing, redirects edges with srcNodeId===varName to var: paths
 * and collects them into opNode.varFields.
 */
function reconstructPredicateOp(
  category: string, op: string, predPort: string,
  ast: AstCall,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
  knownIds?: Set<string>,
): ParsedOperand {
  const opId = `op-r-${counter.n++}`;
  const node: OpNode = { id: opId, category, op, x: 900, y: 50 + out.opNodes.length * 80, literals: {} };
  out.opNodes.push(node);

  // Wire collection
  const collectionOperand = astNodeToChainedOperand(ast.receiver!, out, counter, knownIds);
  wireOperandToPort(collectionOperand, opId, 'collection', out, counter);

  // Determine var name
  const varAst = ast.args[0];
  const varName = varAst.kind === 'raw' ? varAst.text
    : varAst.kind === 'ref' ? varAst.nodeRef
    : varAst.kind === 'literal' ? varAst.value
    : null;
  node.literals['var'] = varName ?? celNodeToCelInner(varAst);

  // Parse pred/expr with varName added to knownIds
  const edgesStart = out.extraEdges.length;
  const predExprStr = celNodeToCelInner(ast.args[1]);
  let predExprOperand: ParsedOperand;
  if (varName && knownIds) {
    const extKnown = new Set([...knownIds, varName]);
    // Use parseParenInner for binary/unary expressions, fall back to parseOperandStr
    const parsed = parseParenInner(predExprStr, extKnown, out, counter)
      ?? parseOperandStr(predExprStr, extKnown, out, counter);
    predExprOperand = parsed;
  } else {
    predExprOperand = astNodeToOperand(ast.args[1]);
  }
  wireOperandToPort(predExprOperand, opId, predPort, out, counter);

  // Redirect edges where srcNodeId === varName to var: field paths
  if (varName) {
    const varFields: string[] = [];
    for (let i = edgesStart; i < out.extraEdges.length; i++) {
      const e = out.extraEdges[i];
      if (e.srcNodeId === varName || e.srcNodeId === refToNodeId(varName)) {
        const newPath = `${VAR_FIELD_PREFIX}${e.srcFieldPath}`;
        out.extraEdges[i] = { ...e, srcNodeId: opId, srcFieldPath: newPath };
        if (!varFields.includes(e.srcFieldPath)) varFields.push(e.srcFieldPath);
      }
    }
    if (varFields.length > 0) node.varFields = varFields;
  }

  return { kind: 'opNode', id: opId };
}

/** Wire a parsed operand to a port on an op node (adding literal or edge). */
function wireOperandToPort(
  operand: ParsedOperand, tgtId: string, portName: string,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): void {
  const node = out.opNodes.find(n => n.id === tgtId);
  if (!node) return;
  if (operand.kind === 'literal') {
    node.literals[portName] = operand.value;
  } else if (operand.kind === 'ref') {
    out.extraEdges.push({
      id: `ee-r-${counter.n++}`,
      srcNodeId: operand.nodeId, srcFieldPath: operand.fieldPath,
      tgtNodeId: tgtId, tgtFieldPath: portName,
    });
  } else {
    out.extraEdges.push({
      id: `ee-r-${counter.n++}`,
      srcNodeId: operand.id, srcFieldPath: 'output',
      tgtNodeId: tgtId, tgtFieldPath: portName,
    });
  }
}

function parseAstCallOperand(
  ast: AstCall,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
  knownIds?: Set<string>,
): ParsedOperand | null {
  if (ast.name === 'orValue' && ast.receiver !== null && ast.args.length === 1) {
    return makeReconOpNode('optional-or-value', 'orValue', {
      opt:     astNodeToChainedOperand(ast.receiver, out, counter, knownIds),
      default: astNodeToOperand(ast.args[0]),
    }, out, counter);
  }
  if (ast.name === 'replace' && ast.receiver !== null && ast.args.length === 2) {
    return makeReconOpNode('string-replace', 'replace', {
      str:  astNodeToChainedOperand(ast.receiver, out, counter, knownIds),
      from: astNodeToOperand(ast.args[0]),
      to:   astNodeToOperand(ast.args[1]),
    }, out, counter);
  }
  if (ast.name === 'hasValue' && ast.receiver !== null && ast.args.length === 0) {
    return makeReconOpNode('has-value', 'hasValue', {
      opt: astNodeToChainedOperand(ast.receiver, out, counter, knownIds),
    }, out, counter);
  }
  if (ast.name === 'exists' && ast.receiver !== null && ast.args.length === 2) {
    return reconstructPredicateOp('exists', 'exists', 'pred', ast, out, counter, knownIds);
  }
  if (ast.name === 'map' && ast.receiver !== null && ast.args.length === 2) {
    return reconstructPredicateOp('map', 'map', 'expr', ast, out, counter, knownIds);
  }
  return null;
}

function addOpEdge(
  parsed: ParsedOperand, resId: string, path: string,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): void {
  if (parsed.kind === 'opNode') {
    out.extraEdges.push({
      id: `ee-r-${counter.n++}`,
      srcNodeId: parsed.id, srcFieldPath: 'output',
      tgtNodeId: resId, tgtFieldPath: path,
    });
  }
}

function walkResourceTemplate(
  obj: any, resId: string, fieldPath: string,
  knownIds: Set<string>,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = fieldPath ? `${fieldPath}.${key}` : key;
    if (typeof val === 'string') {
      if (val.startsWith('${') && val.endsWith('}')) {
        // Case 1: single ${(paren-expr)} — complex CEL produced by buildCelFromChain
        const inner = val.slice(2, -1).trim();
        if (inner.startsWith('(')) {
          const grp = extractGroup(inner, 0);
          if (grp && grp.end === inner.length) {
            const parsed = parseParenInner(grp.inner, knownIds, out, counter);
            if (parsed) addOpEdge(parsed, resId, path, out, counter);
          }
        } else {
          // Try to parse as a method call, binary, unary, or ternary expression
          const ast = parseCelAst(inner, knownIds);
          if (ast.kind === 'call' && ast.receiver !== null) {
            const parsed = parseAstCallOperand(ast, out, counter, knownIds);
            if (parsed) addOpEdge(parsed, resId, path, out, counter);
          } else if (ast.kind === 'binary' || ast.kind === 'unary' || ast.kind === 'ternary') {
            const parsed = celAstToParseOperand(ast, out, counter, knownIds);
            addOpEdge(parsed, resId, path, out, counter);
          } else if (ast.kind === 'ref' && !ast.fieldPath && knownIds.has(ast.nodeRef)) {
            // Bare forEach var ref ${varName} with no field path — generate a direct ExtraEdge.
            // The caller's redirect loop will convert srcNodeId/srcFieldPath to _forEach.<varName>.
            out.extraEdges.push({ id: `ee-r-${counter.n++}`, srcNodeId: ast.nodeRef, srcFieldPath: '', tgtNodeId: resId, tgtFieldPath: path });
          }
        }
      } else if (val.includes('${')) {
        // Case 2: multi-part template like "${ref.a}.${ref.b}" or "${ref.a}suffix"
        if (val.includes('\n')) {
          // Multiline template — preserve verbatim, do not wrap in CEL concat
          const parsed = makeRawTemplateOpNode(val, out, counter);
          addOpEdge(parsed, resId, path, out, counter);
        } else {
          const segments = parseSegments(val, knownIds);
          const hasCel = segments.some(s => s.kind === 'cel');
          if (hasCel && segments.length > 1) {
            const parsed = buildSegmentConcatChain(segments, out, counter);
            if (parsed) addOpEdge(parsed, resId, path, out, counter);
          }
        }
      }
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      walkResourceTemplate(val, resId, path, knownIds, out, counter);
    }
  }
}

/** De-duplicate structurally identical op nodes and merge their output edges. */
function deduplicateOpGraph(
  opNodes: OpNode[],
  extraEdges: ExtraEdge[],
): { opNodes: OpNode[]; extraEdges: ExtraEdge[] } {
  if (opNodes.length === 0) return { opNodes, extraEdges };

  const opIds = new Set(opNodes.map(n => n.id));

  // Map: op node id → (port name → incoming edge source)
  const inputEdgeMap = new Map<string, Map<string, { srcNodeId: string; srcFieldPath: string }>>();
  for (const node of opNodes) inputEdgeMap.set(node.id, new Map());
  for (const edge of extraEdges) {
    if (opIds.has(edge.tgtNodeId)) {
      inputEdgeMap.get(edge.tgtNodeId)!.set(edge.tgtFieldPath, {
        srcNodeId: edge.srcNodeId, srcFieldPath: edge.srcFieldPath,
      });
    }
  }

  // Build dep graph for topo sort (op node → input op node IDs)
  const deps = new Map<string, string[]>();
  for (const node of opNodes) {
    deps.set(node.id, [...inputEdgeMap.get(node.id)!.values()]
      .map(e => e.srcNodeId).filter(id => opIds.has(id)));
  }

  // Topological sort (leaves first)
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    order.push(id);
  };
  for (const node of opNodes) visit(node.id);

  // Process in topo order: compute content key, dedup
  const canonicalFor = new Map<string, string>(); // opId → canonical opId
  const keyToFirst = new Map<string, string>();   // content key → first-seen opId
  const removed = new Set<string>();
  const resolve = (id: string): string => canonicalFor.get(id) ?? id;

  for (const id of order) {
    const node = opNodes.find(n => n.id === id);
    if (!node) continue;
    const def = EXPR_NODE_DEFS[node.category];
    if (!def) { canonicalFor.set(id, id); continue; }
    if (node.category === 'raw-template') {
      const key = `raw-template:${node.literals['value'] ?? ''}`;
      if (keyToFirst.has(key)) {
        canonicalFor.set(id, keyToFirst.get(key)!);
        removed.add(id);
      } else {
        keyToFirst.set(key, id);
        canonicalFor.set(id, id);
      }
      continue;
    }
    const inputs = inputEdgeMap.get(id)!;
    const parts = [`${node.category}:${node.op}`];
    const ports = def.variadic
      ? Array.from({ length: node.portCount ?? def.inputs.length }, (_, i) => String.fromCharCode(65 + i))
      : def.inputs.map(p => p.name);
    for (const portName of ports) {
      const edge = inputs.get(portName);
      parts.push(edge
        ? `${portName}=edge:${resolve(edge.srcNodeId)}:${edge.srcFieldPath}`
        : `${portName}=lit:${node.literals[portName] ?? ''}`);
    }
    const key = parts.join('|');
    if (keyToFirst.has(key)) {
      canonicalFor.set(id, keyToFirst.get(key)!);
      removed.add(id);
    } else {
      keyToFirst.set(key, id);
      canonicalFor.set(id, id);
    }
  }

  if (!removed.size) return { opNodes, extraEdges };

  // Remove input edges to removed nodes; redirect output edges from removed nodes to canonical
  const updated = extraEdges
    .filter(e => !removed.has(e.tgtNodeId))
    .map(e => removed.has(e.srcNodeId) ? { ...e, srcNodeId: resolve(e.srcNodeId) } : e);

  // Deduplicate any resulting identical edges
  const seen = new Set<string>();
  const dedupedEdges = updated.filter(e => {
    const k = `${e.srcNodeId}:${e.srcFieldPath}->${e.tgtNodeId}:${e.tgtFieldPath}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { opNodes: opNodes.filter(n => !removed.has(n.id)), extraEdges: dedupedEdges };
}

/**
 * Parse a single condition/forEach string and add op nodes + extra edges.
 * After building, redirects any self-ref source node IDs (e.g. 'each', forEach var names) to `resId`.
 */
function walkConditionString(
  val: string, resId: string, fieldPath: string,
  knownIds: Set<string>, selfRefIds: Set<string>,
  out: { opNodes: OpNode[]; extraEdges: ExtraEdge[] },
  counter: { n: number },
): void {
  if (!val.includes('${')) return;
  const edgeStart = out.extraEdges.length;

  if (val.startsWith('${') && val.endsWith('}')) {
    const inner = val.slice(2, -1).trim();
    let parsed: ParsedOperand | null = null;
    if (inner.startsWith('(')) {
      const grp = extractGroup(inner, 0);
      if (grp && grp.end === inner.length) {
        parsed = parseParenInner(grp.inner, knownIds, out, counter);
      }
    } else {
      const ast = parseCelAst(inner, knownIds);
      if (ast.kind === 'call' && ast.receiver !== null) {
        parsed = parseAstCallOperand(ast as AstCall, out, counter, knownIds);
      } else if (ast.kind === 'binary' || ast.kind === 'unary' || ast.kind === 'ternary') {
        parsed = celAstToParseOperand(ast, out, counter, knownIds);
      }
    }
    if (parsed) addOpEdge(parsed, resId, fieldPath, out, counter);
  } else if (!val.includes('\n')) {
    const segments = parseSegments(val, knownIds);
    if (segments.some(s => s.kind === 'cel') && segments.length > 1) {
      const parsed = buildSegmentConcatChain(segments, out, counter);
      if (parsed) addOpEdge(parsed, resId, fieldPath, out, counter);
    }
  } else {
    const parsed = makeRawTemplateOpNode(val, out, counter);
    addOpEdge(parsed, resId, fieldPath, out, counter);
  }

  // Redirect self-ref source IDs (e.g. 'each', forEach var names) to the resource's own node ID
  if (selfRefIds.size > 0) {
    for (let i = edgeStart; i < out.extraEdges.length; i++) {
      const e = out.extraEdges[i];
      if (selfRefIds.has(e.srcNodeId)) {
        out.extraEdges[i] = { ...e, srcNodeId: resId };
      }
    }
  }
}

/** Reconstruct OpNodes and ExtraEdges by parsing complex CEL expressions in the composition input. */
export function reconstructOpGraph(input: any, requirements?: any): { opNodes: OpNode[]; extraEdges: ExtraEdge[] } {
  const resources: any[] = input?.resources ?? [];
  // 'schema' and each requirementName are valid CEL identifiers (same as buildGraph).
  const reqNames = ((requirements ?? input?.requirements)?.requiredResources ?? [])
    .map((r: any) => r.requirementName as string).filter(Boolean);
  const known = new Set<string>([...resources.map((r: any) => r.id as string), 'schema', ...reqNames]);
  const out = { opNodes: [] as OpNode[], extraEdges: [] as ExtraEdge[] };
  const counter = { n: 0 };
  for (const res of resources) {
    const varNames = forEachVarNames(res);
    const knownForRes = buildKnownForRes(res, known);
    const selfRefIds = new Set<string>(['each', ...varNames]);
    if (res.template) {
      const edgeStart = out.extraEdges.length;
      walkResourceTemplate(res.template, res.id as string, '', knownForRes, out, counter);
      // Redirect forEach self-refs; qualify with _forEach.<varName>[.<field>] to preserve var identity.
      for (let i = edgeStart; i < out.extraEdges.length; i++) {
        const e = out.extraEdges[i];
        if (!selfRefIds.has(e.srcNodeId)) continue;
        // e.srcNodeId is 'each' or a named forEach var. Build _forEach.<var>[.<field>] path.
        const newPath = e.srcFieldPath
          ? qualifiedPath('forEach', e.srcNodeId + '.' + e.srcFieldPath)
          : qualifiedPath('forEach', e.srcNodeId);
        out.extraEdges[i] = { ...e, srcNodeId: res.id as string, srcFieldPath: newPath };
      }
    }
    toConditionExprs(res.includeWhen).forEach((expr, idx) => {
      walkConditionString(expr, res.id as string, qualifiedPath('includeWhen', String(idx)), knownForRes, selfRefIds, out, counter);
    });
    toConditionExprs(res.readyWhen).forEach((expr, idx) => {
      walkConditionString(expr, res.id as string, qualifiedPath('readyWhen', String(idx)), knownForRes, selfRefIds, out, counter);
    });
    for (const entry of (res.forEach ?? []))
      for (const [varName, val] of Object.entries(entry as Record<string, unknown>))
        walkConditionString(String(val), res.id as string, qualifiedPath('forEach', varName), knownForRes, selfRefIds, out, counter);
  }
  return deduplicateOpGraph(out.opNodes, out.extraEdges);
}
