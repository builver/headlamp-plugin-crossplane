import { celInterpRe, isSimplePath, parseSegments } from './celUtils';
import { nodeIdToRef } from './constants';
import { ExtraEdge, FieldEdit, FieldSuggestion, OutPort, TRow } from './types';

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
      if (children.length > 0) { rows.push({ depth, key, isParent: true, fieldPath: path }); rows.push(...children); }
    } else if (Array.isArray(val) && val.some((item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      // Array of objects — expand into indexed item rows
      rows.push({ depth, key, isParent: true, fieldPath: path, isArrayParent: true });
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        const itemPath = `${path}.${i}`;
        rows.push({ depth: depth + 1, key: String(i), isParent: true, fieldPath: itemPath });
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const children = buildTemplateRows(item, knownIds, outPortPaths, visitedOutPorts, depth + 2, itemPath);
          rows.push(...children);
        }
      }
    } else {
      const isOut = outPortPaths.has(path);
      if (isOut) visitedOutPorts.add(path);
      const outPort = isOut ? { path, short: key } : undefined;
      if (typeof val === 'string') {
        const CEL_RE = celInterpRe();
        const matches: RegExpExecArray[] = [];
        let mm: RegExpExecArray | null;
        while ((mm = CEL_RE.exec(val)) !== null) {
          if (knownIds.has(mm[1])) matches.push(mm);
        }
        if (matches.length === 1 && val.trim() === matches[0][0] && isSimplePath(matches[0][2])) {
          // Pure single simple CEL ref → inPort dot
          const srcPath = matches[0][2];
          rows.push({ depth, key, isParent: false, fieldPath: path, outPort,
            inPort: { ref: matches[0][1], srcPath, srcShort: srcPath.split('.').pop() ?? srcPath } });
        } else if (matches.length > 0) {
          // Composed / multi-ref or complex-path string → segments (with expr pill for complex paths)
          rows.push({ depth, key, isParent: false, fieldPath: path, outPort,
            segments: parseSegments(val, knownIds) });
        } else if (/\$\{/.test(val)) {
          // Multiline or complex CEL that didn't match the simple ref.path regex
          rows.push({ depth, key, isParent: false, fieldPath: path, outPort, celExpr: val });
        } else {
          rows.push({ depth, key, isParent: false, fieldPath: path, outPort, value: val });
        }
      } else if (Array.isArray(val)) {
        rows.push({ depth, key, isParent: false, fieldPath: path, outPort, value: `[${(val as unknown[]).length}]` });
      } else if (val !== null && val !== undefined) {
        rows.push({ depth, key, isParent: false, fieldPath: path, outPort, value: String(val) });
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
      toInsert.push({ depth: d, key: pKey, isParent: true, fieldPath: parentPath, ...(ghostParent && { isGhost: true }) });
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
export function getDeepPath(obj: any, dotPath: string): unknown {
  let cur = obj;
  for (const part of dotPath.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Sets a nested value on obj using a dot-separated path, creating objects or arrays as needed. */
export function setDeepPath(obj: any, dotPath: string, value: any): void {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = nextIsIndex ? [] : {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Deletes a nested key on obj at the given dot-separated path.
 *  If the parent is an array and the key is a numeric index, splices the element out (no holes). */
export function deleteDeepPath(obj: any, dotPath: string): void {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') return;
    cur = cur[parts[i]];
  }
  const lastKey = parts[parts.length - 1];
  if (Array.isArray(cur) && /^\d+$/.test(lastKey)) {
    cur.splice(parseInt(lastKey), 1);
  } else {
    delete cur[lastKey];
  }
}

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
 * Returns a deep clone of `input` with each ExtraEdge applied as a CEL expression
 * on the target resource's template field.
 */
export function applyExtraEdgesToInput(input: any, extraEdges: ExtraEdge[]): any {
  const clone = JSON.parse(JSON.stringify(input));
  for (const edge of extraEdges) {
    const srcRef = nodeIdToRef(edge.srcNodeId);
    const celExpr = `\${${srcRef}.${edge.srcFieldPath}}`;
    const tgtRes = (clone.resources ?? []).find((r: any) => r.id === edge.tgtNodeId);
    if (!tgtRes) continue;
    if (!tgtRes.template) tgtRes.template = {};
    setDeepPath(tgtRes.template, edge.tgtFieldPath, celExpr);
  }
  return clone;
}

/** Deep-clone `input` and apply field template edits. Empty template means delete the field. */
export function applyFieldEditsToInput(input: any, fieldEdits: FieldEdit[]): any {
  const clone = JSON.parse(JSON.stringify(input));
  for (const edit of fieldEdits) {
    const tgtRes = (clone.resources ?? []).find((r: any) => r.id === edit.nodeId);
    if (!tgtRes) continue;
    const isExtRef = tgtRes.externalRef !== undefined && tgtRes.template === undefined;
    if (edit.template === '') {
      if (tgtRes.template) { deleteDeepPath(tgtRes.template, edit.fieldPath); pruneEmptyAncestors(tgtRes.template, edit.fieldPath); }
      if (isExtRef) { deleteDeepPath(tgtRes.externalRef, edit.fieldPath); pruneEmptyAncestors(tgtRes.externalRef, edit.fieldPath); }
    } else if (isExtRef) {
      setDeepPath(tgtRes.externalRef, edit.fieldPath, edit.template);
    } else {
      if (!tgtRes.template) tgtRes.template = {};
      setDeepPath(tgtRes.template, edit.fieldPath, edit.template);
    }
  }
  return clone;
}

/**
 * Remove a leaf row at `fieldPath` from `rows`, then prune any parent rows that
 * become childless as a result (repeated until stable for nested empty parents).
 */
export function removeRowAtPath(rows: TRow[], fieldPath: string): TRow[] {
  // Remove target and all descendant rows (needed when deleting an array item parent)
  let result = rows.filter(r => r.fieldPath !== fieldPath && !r.fieldPath?.startsWith(fieldPath + '.'));
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
