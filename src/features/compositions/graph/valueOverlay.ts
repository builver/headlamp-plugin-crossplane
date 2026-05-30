import { nodeH } from './constants';
import { decodePathKey, encodePathKey } from './pathUtils';
import { insertRowAtPath } from './rowUtils';
import { GNode } from './types';

/**
 * Recursively flatten a JSON object to a Map of dot-separated paths -> string values.
 * Only leaf nodes (non-object, non-array) are included.
 */
export function flattenResource(obj: any, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  if (obj === null || obj === undefined || typeof obj !== 'object') return result;

  for (const [key, val] of Object.entries(obj)) {
    const segKey = encodePathKey(key);
    const path = prefix ? `${prefix}.${segKey}` : segKey;
    if (val === null || val === undefined) {
      // Treat null / undefined leaves as absent — emitting them as the literal
      // string "null" is indistinguishable from a real string value and would
      // trigger spurious mismatch warnings.
      continue;
    } else if (Array.isArray(val)) {
      const before = result.size;
      for (let i = 0; i < val.length; i++) {
        const itemPath = `${path}.${i}`;
        if (val[i] === null || val[i] === undefined) continue;
        if (typeof val[i] === 'object') {
          for (const [k, v] of flattenResource(val[i], itemPath)) {
            result.set(k, v);
          }
        } else {
          result.set(itemPath, String(val[i]));
        }
      }
      // Surface an explicitly empty array (or one with only null elements) so
      // it shows up as a row instead of being silently dropped.
      if (result.size === before) result.set(path, '[]');
    } else if (typeof val === 'object') {
      const before = result.size;
      for (const [k, v] of flattenResource(val, path)) {
        result.set(k, v);
      }
      // Same for explicitly empty objects.
      if (result.size === before) result.set(path, '{}');
    } else {
      result.set(path, String(val));
    }
  }
  return result;
}

/**
 * Collapse the per-field values across a collection's instances into one label.
 * Uniform values render as-is; differing values are listed (capped with "+N").
 */
function aggregateValues(values: string[]): string {
  const uniq = Array.from(new Set(values));
  if (uniq.length === 1) return uniq[0];
  const shown = uniq.slice(0, 3).join(', ');
  return uniq.length > 3 ? `${shown}, +${uniq.length - 3}` : shown;
}

/** Hidden by default at any depth (e.g. provider-kubernetes mirrors metadata
 *  under status.atProvider):
 *  - managedFields / ownerReferences — internal apiserver bookkeeping.
 *  - uid / resourceVersion / generation — cluster-assigned identifiers that
 *    change every reconcile and never reflect user intent.
 *  Kept visible per user direction: creationTimestamp, deletionTimestamp,
 *  finalizers, spec.crossplane.*. */
function isHiddenPath(path: string): boolean {
  return /(^|\.)metadata\.(managedFields|ownerReferences|uid|resourceVersion|generation)(\.|$)/.test(path);
}

/** Compact summary for an object/array-typed leaf whose only observed evidence
 *  is its descendant paths. Returns e.g. `{x, y}` for an object with two keys,
 *  `[3]` for an array with three entries, or `''` if nothing matches. */
function summarizeChildren(prefix: string, paths: Iterable<string>): string {
  const keys = new Set<string>();
  for (const p of paths) {
    if (p.startsWith(prefix)) {
      const k = p.slice(prefix.length).split('.')[0];
      if (k) keys.add(decodePathKey(k));
    }
  }
  const arr = [...keys];
  if (arr.length === 0) return '';
  if (arr.every(k => /^\d+$/.test(k))) return `[${arr.length}]`;
  return arr.length <= 3
    ? `{${arr.join(', ')}}`
    : `{${arr.slice(0, 3).join(', ')}, …+${arr.length - 3}}`;
}

/** Path comparator that compares integer segments numerically so array indices
 *  render in natural order (0, 1, 2, … 10, 11) instead of lexicographic
 *  (0, 1, 10, 11, 2, 3, …). */
function comparePaths(a: string, b: string): number {
  const aSegs = a.split('.');
  const bSegs = b.split('.');
  for (let i = 0; i < Math.min(aSegs.length, bSegs.length); i++) {
    const aSeg = aSegs[i];
    const bSeg = bSegs[i];
    const aIsNum = /^\d+$/.test(aSeg);
    const bIsNum = /^\d+$/.test(bSeg);
    if (aIsNum && bIsNum) {
      const diff = Number(aSeg) - Number(bSeg);
      if (diff !== 0) return diff;
    } else if (aSeg !== bSeg) {
      return aSeg < bSeg ? -1 : 1;
    }
  }
  return aSegs.length - bSegs.length;
}

/**
 * Overlay actual resolved values from composed resources onto graph nodes,
 * merging the live resource with the composition template: template fields the
 * live resource lacks are kept, and live fields the composition does not
 * reference (e.g. status.conditions) are added as observed-only rows.
 *
 * @param nodes - graph nodes from buildGraph
 * @param composedValues - Map of kro resource ID -> fetched resource JSON(s).
 *   kro-resource nodes carry composed resources; the schema node mirrors the XR.
 *   A forEach collection node maps to multiple instances; their per-field values
 *   are aggregated into a single label.
 */
export function overlayActualValues(
  nodes: GNode[],
  composedValues: Map<string, any[]>
): GNode[] {
  if (composedValues.size === 0) return nodes;

  return nodes.map(n => {
    if (n.type !== 'kro-resource' && n.type !== 'schema') return n;
    const resources = composedValues.get(n.id);
    if (!resources || resources.length === 0) return n;

    // Aggregate every observed leaf value by path across all instances.
    const valuesByPath = new Map<string, string[]>();
    for (const r of resources) {
      for (const [path, val] of flattenResource(r)) {
        if (isHiddenPath(path)) continue;
        const arr = valuesByPath.get(path);
        if (arr) arr.push(val);
        else valuesByPath.set(path, [val]);
      }
    }
    if (valuesByPath.size === 0) return n;

    // Template leaf paths (non-parent, non-section) — observed-only extras must
    // NOT be spliced underneath these, or insertRowAtPath produces a malformed
    // sub-tree (leaf row with isParent:false and indented children below it).
    const leafPaths: string[] = [];
    for (const row of n.rows) {
      if (!row.isParent && !row.isSection && row.fieldPath) {
        leafPaths.push(row.fieldPath);
      }
    }
    const isUnderLeaf = (p: string) => leafPaths.some(l => p.startsWith(`${l}.`));

    // 1. Annotate existing template rows with their observed value. When a leaf
    //    has no direct match but its descendants are present (template references
    //    an object-typed field via CEL), synthesize a compact summary so the
    //    pill carries an observed label without decomposing the tree.
    const existing = new Set<string>();
    let rows = n.rows.map(row => {
      if (row.fieldPath) existing.add(row.fieldPath);
      if (row.isParent || row.isSection || !row.fieldPath) return row;
      const direct = valuesByPath.get(row.fieldPath);
      if (direct) return { ...row, actualValue: aggregateValues(direct) };
      const summary = summarizeChildren(`${row.fieldPath}.`, valuesByPath.keys());
      return summary ? { ...row, actualValue: summary } : row;
    });

    // 2. Merge in observed-only fields the composition does not reference,
    //    skipping anything under a template leaf (see leafPaths above).
    const extras = [...valuesByPath.keys()]
      .filter(p => !existing.has(p) && !isUnderLeaf(p))
      .sort(comparePaths);
    for (const path of extras) {
      rows = insertRowAtPath(rows, path, {
        actualValue: aggregateValues(valuesByPath.get(path)!),
        canImport: false,
        canExport: false,
      });
    }

    return { ...n, rows, h: nodeH(rows) };
  });
}
