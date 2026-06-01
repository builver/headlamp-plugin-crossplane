import { collectCelMatches, findCelRefs, parseSingleRefMatch, reconstructTemplate, stripOptionalMarkers } from './celUtils';
import { buildVarFieldRows, EDGE_TYPE_FOR, EXPR_NODE_HDR_H, EXPR_NODE_PORT_H, EXPR_NODE_W, exprNodeH, exprNodeInputPortY, exprNodeOutputPortY, exprNodeVarFieldExtraRows, H_GAP, NODE_HDR_H, NODE_MIN_H, NODE_ROW_H, NODE_W, nodeH, nodeIdToRef, RAW_TEMPLATE_NODE_H, refToNodeId, SCHEMA_NODE_ID, V_GAP,VAR_FIELD_PREFIX, varFieldLeafRow } from './constants';
import { EXPR_NODE_DEFS } from './exprGraph/exprNodeDefs';
import { getDeepPath } from './pathUtils';
import { buildKnownForRes, buildSpecialFieldRows, buildTemplateRows, forEachVarNames, insertRowAtPath, makeLeafRow, postProcessEachRefs, reconstructOpGraph } from './rowUtils';
import { qualifiedPath, sectionOf, sectionRelPath } from './sectionDefs';
import { CelRef, ExprNode, ExtraEdge, GraphEdge, GraphNode, NodeRow,NodeType, OutputPort } from './types';

// ── DAG layout ─────────────────────────────────────────────────────────────────

export function dagLayout(
  nodesIn: Array<{ id: string; h: number }>,
  deps: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const ids  = nodesIn.map(n => n.id);
  const hMap = new Map(nodesIn.map(n => [n.id, n.h]));

  // Build adjacency lists (keep inn separate — Kahn's modifies inDeg in place)
  const inDeg = new Map<string, number>(ids.map(id => [id, 0]));
  const out   = new Map<string, string[]>(ids.map(id => [id, []]));
  const inn   = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const { source: s, target: t } of deps) {
    if (inDeg.has(t) && out.has(s)) {
      inDeg.set(t, inDeg.get(t)! + 1);
      out.get(s)!.push(t);
      inn.get(t)!.push(s);
    }
  }

  // Kahn's BFS — assign topological layers
  const layer = new Map<string, number>();
  let wave = ids.filter(id => !inDeg.get(id));
  for (let d = 0; wave.length; d++) {
    const next: string[] = [];
    for (const id of wave) {
      if (!layer.has(id)) layer.set(id, d);
      for (const nb of out.get(id)!) { const nd = inDeg.get(nb)! - 1; inDeg.set(nb, nd); if (!nd) next.push(nb); }
    }
    wave = next;
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);

  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layer) { if (!byLayer.has(l)) byLayer.set(l, []); byLayer.get(l)!.push(id); }
  const layerCount = byLayer.size ? Math.max(...byLayer.keys()) + 1 : 0;

  // ── Barycenter crossing-reduction (Sugiyama) ─────────────────────────────────
  // Track each node's rank (float) within its layer for barycenter computation.
  const rank = new Map<string, number>();
  for (const [, lIds] of byLayer) lIds.forEach((id, i) => rank.set(id, i));

  const bc = (id: string, nbrs: string[]) =>
    nbrs.length ? nbrs.reduce((s, nb) => s + (rank.get(nb) ?? 0), 0) / nbrs.length : (rank.get(id) ?? 0);

  // Three forward + backward passes — good enough for typical composition graphs
  for (let pass = 0; pass < 3; pass++) {
    for (let l = 1; l < layerCount; l++) {
      const lIds = byLayer.get(l); if (!lIds) continue;
      lIds.sort((a, b) => bc(a, inn.get(a)!) - bc(b, inn.get(b)!));
      lIds.forEach((id, i) => rank.set(id, i));
    }
    for (let l = layerCount - 2; l >= 0; l--) {
      const lIds = byLayer.get(l); if (!lIds) continue;
      lIds.sort((a, b) => bc(a, out.get(a)!) - bc(b, out.get(b)!));
      lIds.forEach((id, i) => rank.set(id, i));
    }
  }

  // ── Position nodes ────────────────────────────────────────────────────────────
  const colH = (ids2: string[]) => ids2.reduce((s, id) => s + (hMap.get(id) ?? NODE_MIN_H) + V_GAP, -V_GAP);
  const maxH = Math.max(...[...byLayer.values()].map(colH), 0);
  const pos  = new Map<string, { x: number; y: number }>();
  for (const [l, lIds] of byLayer) {
    let curY = (maxH - colH(lIds)) / 2;
    for (const id of lIds) { pos.set(id, { x: l * (NODE_W + H_GAP), y: curY }); curY += (hMap.get(id) ?? NODE_MIN_H) + V_GAP; }
  }
  return pos;
}

// ── Graph builder ──────────────────────────────────────────────────────────────

/**
 * Like findCelRefs but only returns refs where the entire field value is
 * exactly `${ref.simpleHath}` — no surrounding text, no operators, one ref.
 * Used to restrict GraphEdge arrows to direct field-to-field connections.
 *
 * Tracks the dot-path to each ref within the template so callers can build
 * per-target-field edges (two fields with the same CEL expression need
 * distinct edges, not a single deduped one).
 */
function collectSimpleRefs(template: unknown, known: Set<string>): Array<CelRef & { tgtFieldPath: string }> {
  const out: Array<CelRef & { tgtFieldPath: string }> = [];
  const walk = (obj: unknown, path: string): void => {
    if (typeof obj === 'string') {
      const matches = collectCelMatches(obj, known);
      const single = parseSingleRefMatch(matches, obj);
      if (single) {
        out.push({ srcRef: single.ref, srcPath: single.srcPath, srcShort: single.srcShort, tgtFieldPath: path });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i)));
    } else if (obj !== null && typeof obj === 'object') {
      Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
    }
  };
  walk(template, '');
  return out;
}


/** Returns true if a condition expression field has any value (non-empty array, or any non-null scalar). */
// eslint-disable-next-line eqeqeq
function hasCond(v: unknown): boolean { return Array.isArray(v) ? v.length > 0 : v != null; }

/** AllRef: a CEL ref augmented with its graph context, used only inside buildGraph.
 *  `tgtFieldPath` is set only for simpleRefs (drives unique GraphEdges per target field). */
type AllRef = CelRef & { targetId: string; srcNodeId: string; isForEachVarRef?: boolean; tgtFieldPath?: string };

/** Outer-scope variables captured by makeNode — passed explicitly to keep the function testable. */
interface MakeNodeContext {
  outPortsMap: Map<string, Map<string, OutputPort>>;
  forEachVarFields: Map<string, Map<string, string[]>>;
  forEachVarFieldsFlat: Map<string, Set<string>>;
  opEdges: ExtraEdge[];
  opNdIds: Set<string>;
  known: Set<string>;
}

function makeNode(
  id: string, type: NodeType, label: string,
  template: any | null, sublabel: string | undefined, res: any | undefined,
  ctx: MakeNodeContext,
): GraphNode {
  const { outPortsMap, forEachVarFields, forEachVarFieldsFlat, opEdges, opNdIds, known } = ctx;
  const opArr   = [...(outPortsMap.get(id) ?? new Map()).values()]
    .sort((a, b) => a.path.localeCompare(b.path));
  const opPaths = new Set(opArr.map(p => p.path));
  const visited = new Set<string>();
  const varNames = res ? forEachVarNames(res) : [];
  const knownForRows = res ? buildKnownForRes(res, known) : known;
  let rows = template ? buildTemplateRows(template, knownForRows, opPaths, visited) : [];
  // Insert unvisited outPort rows alphabetically alongside template rows.
  // Look up the actual primitive value so it can be displayed even without a template row.
  for (const op of opArr.filter(p => !visited.has(p.path))) {
    const raw = template ? getDeepPath(template, op.path) : undefined;
    const value = raw !== null && raw !== undefined && typeof raw !== 'object' ? String(raw) : undefined;
    rows = insertRowAtPath(rows, op.path, { outPort: op, value });
  }
  // Remove pass-through forEach var rows, collect bare ${varName} usages, redirect self-refs.
  const bareVarUsages = new Map<string, string[]>();
  if (varNames.length) {
    const varNameSet = new Set(varNames);
    const flatFields = forEachVarFieldsFlat.get(id) ?? new Set<string>();
    rows = rows.filter(row => {
      // Simple direct ref: ${foo.loopvariable} → inPort row where key === accessed field name
      if (row.inPort && varNameSet.has(row.inPort.ref) && row.inPort.srcPath !== '' && row.key === row.inPort.srcShort)
        return false;
      // Complex expr or op-driven: key is a known forEach var field and row has CEL content (not a static value)
      if (!row.inPort && flatFields.has(row.key) && (!!row.celExpr || !!row.segments || !!row.outPort))
        return false;
      return true;
    });
    // Capture bare ${varName} usages (srcPath === '') before ref is redirected by postProcessEachRefs.
    for (const row of rows) {
      if (row.inPort && row.inPort.srcPath === '' && varNameSet.has(row.inPort.ref) && row.fieldPath) {
        const vn = row.inPort.ref;
        if (!bareVarUsages.has(vn)) bareVarUsages.set(vn, []);
        bareVarUsages.get(vn)!.push(row.fieldPath);
      }
    }
    rows = postProcessEachRefs(rows, id, new Set(['each', ...varNames]));
  }
  // Append forEach / includeWhen / readyWhen section rows for resource nodes that have them.
  const resHasIncludeWhen = res && hasCond(res.includeWhen);
  const resHasReadyWhen = res && hasCond(res.readyWhen);
  let processedSpecial: NodeRow[] = [];
  if (res && (res.forEach?.length || resHasIncludeWhen || resHasReadyWhen)) {
    const knownForSpec = buildKnownForRes(res, known);
    const selfRefs = new Set<string>(['each', ...varNames]);
    // Build outPort map for forEach KV rows from op edges. Any _forEach.<var>[.<field>] path
    // maps back to the KV row at _forEach.<var> so the KV row carries the confirmed port dot.
    const forEachOutPorts = new Map<string, OutputPort>();
    for (const e of opEdges) {
      if (!opNdIds.has(e.srcNodeId) && e.srcNodeId === id && sectionOf(e.srcFieldPath) === 'forEach') {
        const relPath = sectionRelPath(e.srcFieldPath);
        const varName = relPath.split('.')[0];
        const kvPath = qualifiedPath('forEach', varName);
        if (!forEachOutPorts.has(kvPath)) forEachOutPorts.set(kvPath, { path: kvPath, short: varName });
      }
    }
    const specialRows = buildSpecialFieldRows(res, knownForSpec).map(row =>
      (!row.isSection && row.fieldPath && forEachOutPorts.has(row.fieldPath))
        ? { ...row, outPort: forEachOutPorts.get(row.fieldPath) }
        : row
    );
    processedSpecial = postProcessEachRefs(specialRows, id, selfRefs);
  }
  // Always prepend a "template" section header for resource nodes so the schema-unavailable
  // warning and add-field affordance have a consistent place to render — even when the template
  // is empty.
  if (res) {
    const templateHeader: NodeRow = { depth: 0, key: 'template', isParent: false, isSection: true, canImport: false, canExport: false };
    rows = [...processedSpecial, templateHeader, ...rows];
  } else if (processedSpecial.length > 0) {
    rows = [...processedSpecial, ...rows];
  }
  // For fields driven by an op node (concat, replace, etc.), replace the segments display with
  // celExpr so RowsNodeCard shows the raw template rather than misleading direct-ref source pills.
  // Runs after special rows are merged so includeWhen/readyWhen/forEach rows are also converted.
  const opTargetPaths = new Set(
    opEdges
      .filter(e => e.tgtNodeId === id && opNdIds.has(e.srcNodeId) && e.srcFieldPath === 'output')
      .map(e => e.tgtFieldPath)
  );
  if (opTargetPaths.size > 0) {
    rows = rows.map(row => {
      if (!row.isParent && row.segments && row.fieldPath && opTargetPaths.has(row.fieldPath)) {
        // eslint-disable-next-line no-unused-vars
        const { segments: _s, inPort: _i, ...rest } = row;
        // For template rows, get raw value from template; for special section rows fall back
        // to reconstructing from segments (getDeepPath won't find _includeWhen.* etc.).
        const rawVal = template ? getDeepPath(template, row.fieldPath) : undefined;
        const celExpr = typeof rawVal === 'string' ? rawVal : reconstructTemplate(row.segments!);
        return { ...rest, celExpr };
      }
      return row;
    });
  }
  // Build forEach sub-rows: one output-port row per ${varName.field} access in the template.
  if (res?.forEach?.length) {
    const varFieldMap = forEachVarFields.get(id) ?? new Map<string, string[]>();
    const enriched: NodeRow[] = [];
    for (const row of rows) {
      enriched.push(row);
      if (!row.isSection && !row.isParent && row.fieldPath && sectionOf(row.fieldPath) === 'forEach') {
        const varName = sectionRelPath(row.fieldPath);
        // Only top-level variable rows (not already-sub-field rows like _forEach.role.name).
        if (varName.includes('.')) continue;
        for (const field of (varFieldMap.get(varName) ?? [])) {
          const subFp = qualifiedPath('forEach', varName + '.' + field);
          // Skip if a user-added (isVirtual) sub-row already exists.
          if (enriched.some(r => r.fieldPath === subFp)) continue;
          enriched.push(makeLeafRow(row.depth + 1, field, subFp, undefined, new Set(),
            { isForEachSubField: true, canImport: false, canExport: true, outPort: { path: subFp, short: field } }));
        }
      }
    }
    rows = enriched;
  }
  // Strip leading '?' from row keys produced by optional-chaining paths (e.g. '?name' → 'name').
  rows = rows.map(r => r.key.startsWith('?') ? { ...r, key: r.key.slice(1) } : r);
  const isCollection = !!(res?.forEach?.length);
  return { id, type, label, sublabel, rows, x: 0, y: 0, w: NODE_W, h: nodeH(rows), isCollection };
}

export function buildGraph(input: any, requirements?: any): { nodes: GraphNode[]; edges: GraphEdge[]; exprNodes: ExprNode[]; extraEdges: ExtraEdge[] } {
  const resources: any[] = input?.resources ?? [];
  if (!resources.length) return { nodes: [], edges: [], exprNodes: [], extraEdges: [] };
  const envReqs: any[] = (requirements ?? input?.requirements)?.requiredResources ?? [];
  const reqNames = envReqs.map((r: any) => r.requirementName as string).filter(Boolean);
  const resIds = new Set(resources.map((r: any) => r.id as string));
  // 'schema' and each requirementName are valid CEL identifiers.
  const known  = new Set<string>([...resIds, 'schema', ...reqNames]);

  const allRefs: AllRef[] = [];      // all refs — drives outPortsMap and layout deps
  const simpleRefs: AllRef[] = [];   // exact-match refs only — drives GraphEdge arrows
  // forEach variable field accesses: nodeId → varName → [field, ...]
  // Collected from ${varName.field} patterns in each resource's template.
  const forEachVarFields = new Map<string, Map<string, string[]>>();
  // Flat per-node set of forEach variable field names — built incrementally alongside forEachVarFields.
  const forEachVarFieldsFlat = new Map<string, Set<string>>();
  for (const res of resources) {
    const varNames = forEachVarNames(res);
    const knownForRes = buildKnownForRes(res, known);
    for (const ref of findCelRefs(res.template ?? null, knownForRes)) {
      const isNamedVar = varNames.includes(ref.srcRef); // named forEach var (not 'each')
      const isSelf = ref.srcRef === 'each' || isNamedVar;
      const srcRef = isSelf ? nodeIdToRef(res.id as string) : ref.srcRef;
      allRefs.push({ ...ref, srcRef, targetId: res.id as string, srcNodeId: refToNodeId(srcRef), isForEachVarRef: isNamedVar && !!ref.srcPath });
      // Track accessed field for forEach sub-rows
      if (isNamedVar && ref.srcPath) {
        const nodeId = res.id as string;
        if (!forEachVarFields.has(nodeId)) forEachVarFields.set(nodeId, new Map());
        const vm = forEachVarFields.get(nodeId)!;
        if (!vm.has(ref.srcRef)) vm.set(ref.srcRef, []);
        const topField = ref.srcPath.replace(/\?/g, '').split('.')[0];
        if (!vm.get(ref.srcRef)!.includes(topField)) vm.get(ref.srcRef)!.push(topField);
        if (!forEachVarFieldsFlat.has(nodeId)) forEachVarFieldsFlat.set(nodeId, new Set());
        forEachVarFieldsFlat.get(nodeId)!.add(topField);
      }
    }
    for (const ref of collectSimpleRefs(res.template ?? null, known)) {
      simpleRefs.push({ ...ref, targetId: res.id as string, srcNodeId: refToNodeId(ref.srcRef) });
    }
    // Collect simple refs from forEach field values for direct edge arrows.
    // Uses `known` (not knownForRes) so self-refs (each, var names) are excluded.
    // The walker reports a path like `<varName>` within the entry — qualify it with
    // the forEach section prefix so it matches the resource row's fieldPath.
    for (const entry of (res.forEach ?? [])) {
      for (const ref of collectSimpleRefs(entry, known)) {
        simpleRefs.push({
          ...ref,
          tgtFieldPath: qualifiedPath('forEach', ref.tgtFieldPath),
          targetId: res.id as string,
          srcNodeId: refToNodeId(ref.srcRef),
        });
      }
    }
    // Scan special fields (forEach/includeWhen/readyWhen) for layout deps and output ports
    const hasIncludeWhen = hasCond(res.includeWhen);
    const hasReadyWhen = hasCond(res.readyWhen);
    if (varNames.length || hasIncludeWhen || hasReadyWhen) {
      const toCondExprs = (v: unknown): string[] =>
        // eslint-disable-next-line eqeqeq
        Array.isArray(v) ? v.map(String).filter(Boolean) : (v != null ? [String(v)] : []);
      const specialVals: string[] = [
        ...toCondExprs(res.includeWhen),
        ...toCondExprs(res.readyWhen),
        ...(res.forEach ?? []).flatMap((e: any) => Object.values(e as Record<string, unknown>).map(String)),
      ];
      for (const val of specialVals) {
        for (const ref of findCelRefs(val, knownForRes)) {
          const isSelf = ref.srcRef === 'each' || varNames.includes(ref.srcRef);
          const srcRef = isSelf ? nodeIdToRef(res.id as string) : ref.srcRef;
          allRefs.push({ ...ref, srcRef, targetId: res.id as string, srcNodeId: refToNodeId(srcRef) });
        }
      }
    }
  }

  const outPortsMap = new Map<string, Map<string, OutputPort>>();
  for (const r of allRefs) {
    // forEach variable field refs (${varName.field}) go to forEach sub-rows, not the manifest outPortsMap.
    if (r.isForEachVarRef) continue;
    if (!outPortsMap.has(r.srcNodeId)) outPortsMap.set(r.srcNodeId, new Map());
    const m = outPortsMap.get(r.srcNodeId)!;
    if (!m.has(r.srcPath)) m.set(r.srcPath, { path: r.srcPath, short: r.srcShort });
  }
  // Also add output ports for fields referenced through op-node chains (e.g. concat expressions).
  // findCelRefs misses these because the CEL template starts with `${(` rather than `${id.`.
  const { extraEdges: opEdges, exprNodes: opNds } = reconstructOpGraph(input, requirements);
  const opNdIds = new Set(opNds.map(n => n.id));
  for (const e of opEdges) {
    if (e.srcFieldPath === 'output' || opNdIds.has(e.srcNodeId)) continue;
    // forEach section paths belong to the forEach section rows, not the template body outPortsMap.
    if (sectionOf(e.srcFieldPath) === 'forEach') continue;
    // forEach variable field refs (via op-node chains) also belong to forEach sub-rows.
    if (forEachVarFieldsFlat.get(e.srcNodeId)?.has(e.srcFieldPath)) continue;
    const srcRef = nodeIdToRef(e.srcNodeId);
    if (!known.has(srcRef)) continue;
    if (!outPortsMap.has(e.srcNodeId)) outPortsMap.set(e.srcNodeId, new Map());
    const m = outPortsMap.get(e.srcNodeId)!;
    const short = e.srcFieldPath.split('.').pop() ?? e.srcFieldPath;
    if (!m.has(e.srcFieldPath)) m.set(e.srcFieldPath, { path: e.srcFieldPath, short });
  }

  const ctx: MakeNodeContext = { outPortsMap, forEachVarFields, forEachVarFieldsFlat, opEdges, opNdIds, known };

  const nodes: GraphNode[] = [];
  nodes.push(makeNode(SCHEMA_NODE_ID, 'schema', 'schema', null, undefined, undefined, ctx));
  // One node per required resource — node ID = requirementName (also the CEL identifier).
  for (const req of envReqs) {
    const reqName = req.requirementName as string;
    if (!reqName) continue;
    const displayTemplate: Record<string, unknown> = {};
    if (req.apiVersion) displayTemplate.apiVersion = req.apiVersion;
    if (req.kind)       displayTemplate.kind       = req.kind;
    const metadata: Record<string, string> = {};
    if (req.name)      metadata.name      = req.name;
    if (req.namespace) metadata.namespace = req.namespace;
    if (Object.keys(metadata).length) displayTemplate.metadata = metadata;
    nodes.push(makeNode(reqName, 'env', reqName, Object.keys(displayTemplate).length ? displayTemplate : null, undefined, undefined, ctx));
  }
  for (const res of resources) {
    if (res.externalRef) {
      // Build a display-only template from the externalRef fields so rows show apiVersion, kind, and name/selector.
      const displayTemplate = {
        apiVersion: res.externalRef.apiVersion,
        kind: res.externalRef.kind,
        ...(res.externalRef.metadata ? { metadata: res.externalRef.metadata } : {}),
      };
      nodes.push(makeNode(res.id, 'kro-ref', res.id, displayTemplate, undefined, res, ctx));
    } else {
      nodes.push(makeNode(res.id, 'kro-resource', res.id, res.template ?? null, undefined, res, ctx));
    }
  }

  const edgesSeen = new Set<string>(); const edges: GraphEdge[] = [];
  const rawDeps: Array<{ source: string; target: string }> = []; const depsSeen = new Set<string>();
  // GraphEdge arrows — only for exact single-ref fields (complex expressions render via op-node ExtraEdges).
  // Dedup key includes `tgtFieldPath` so two fields with the same `${ref.path}` CEL expression
  // produce distinct edges (one per target field), each anchored at its own row in tgtPortY.
  for (const r of simpleRefs) {
    const tgtFieldPath = r.tgtFieldPath ?? '';
    const eid2 = `${r.srcNodeId}::${r.srcPath}→${r.targetId}::${tgtFieldPath}`;
    if (!edgesSeen.has(eid2)) {
      edgesSeen.add(eid2);
      edges.push({ id: eid2, source: r.srcNodeId, target: r.targetId,
        srcPortPath: r.srcPath, tgtPortKey: `${r.srcRef}::${r.srcPath}`,
        tgtFieldPath,
        type: (EDGE_TYPE_FOR[r.srcRef] ?? 'kro-dep') as GraphEdge['type'] });
    }
  }
  // Self-loop GraphEdges: forEach var field refs → template fields on the same resource node.
  // These are direct connections like ${binding.namespace} → metadata.namespace where source
  // and target are the same node. collectSimpleRefs uses `known` (no forEach var names) so they
  // never enter simpleRefs; we emit them explicitly here after all nodes are built.
  const builtNodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const [id, varFieldMap] of forEachVarFields) {
    const node = builtNodeMap.get(id);
    if (!node) continue;
    for (const [varName, fields] of varFieldMap) {
      for (const field of fields) {
        const srcPortPath = qualifiedPath('forEach', varName + '.' + field);
        for (const row of node.rows) {
          if (!row.inPort || row.inPort.ref !== id) continue;
          const topField = row.inPort.srcPath.replace(/\?/g, '').split('.')[0];
          if (topField !== field) continue;
          const tgtPortKey = `${id}::${row.inPort.srcPath}`;
          // Include row's fieldPath in the dedup key so distinct target fields
          // sharing the same forEach var produce distinct edges.
          const tgtFieldPath = row.fieldPath ?? '';
          const eid2 = `${id}::${srcPortPath}→${tgtPortKey}::${tgtFieldPath}`;
          if (!edgesSeen.has(eid2)) {
            edgesSeen.add(eid2);
            edges.push({ id: eid2, source: id, target: id, srcPortPath, tgtPortKey, tgtFieldPath, type: 'kro-dep' });
          }
        }
      }
    }
  }
  // Layout deps from direct refs — skip self-loops (resource referencing itself via each/forEach).
  for (const r of allRefs) {
    if (r.srcNodeId === r.targetId) continue;
    const dk = `${r.srcNodeId}→${r.targetId}`;
    if (!depsSeen.has(dk)) { depsSeen.add(dk); rawDeps.push({ source: r.srcNodeId, target: r.targetId }); }
  }
  // Op-node edges — add directly so op nodes participate in the DAG layout as first-class nodes.
  // Self-ref sources (resource nodes that are also op-edge targets via forEach) form a cycle
  // resource → op-chain → resource that breaks Kahn's BFS. We break the cycle by:
  //   • Propagating "taint" from self-ref sources through the op graph.
  //   • Allowing resource → taintedOp edges (so tainted ops land to the RIGHT of the resource).
  //   • Excluding taintedOp → resource back-edges (the backward half that would close the cycle).
  const opTargetRegularNodes = new Set<string>(
    opEdges.filter(e => !opNdIds.has(e.tgtNodeId)).map(e => e.tgtNodeId)
  );
  const forEachTaintedOps = new Set<string>();
  let taintChanged = true;
  while (taintChanged) {
    taintChanged = false;
    for (const e of opEdges) {
      if (!opNdIds.has(e.tgtNodeId)) continue;
      if ((opTargetRegularNodes.has(e.srcNodeId) || forEachTaintedOps.has(e.srcNodeId)) && !forEachTaintedOps.has(e.tgtNodeId)) {
        forEachTaintedOps.add(e.tgtNodeId);
        taintChanged = true;
      }
    }
  }

  // Predicate var field taint propagation
  // Initial sources: for each op P where hasPredicate && varFields.length > 0,
  // any edge from P's var: ports to another op node taints the target with P's id.
  const predicateTaints = new Map<string, Set<string>>(); // opId → Set<taintId>
  for (const e of opEdges) {
    if (!opNdIds.has(e.srcNodeId) || !opNdIds.has(e.tgtNodeId)) continue;
    if (!e.srcFieldPath.startsWith('var:')) continue;
    const srcOp = opNds.find(n => n.id === e.srcNodeId);
    if (!srcOp?.varFields?.length) continue;
    if (!predicateTaints.has(e.tgtNodeId)) predicateTaints.set(e.tgtNodeId, new Set());
    predicateTaints.get(e.tgtNodeId)!.add(e.srcNodeId);
  }
  // Fixpoint: propagate predicate taints through op→op edges,
  // except taint X is consumed when reaching the predicatePort of op X.
  let predChanged = true;
  while (predChanged) {
    predChanged = false;
    for (const e of opEdges) {
      if (!opNdIds.has(e.tgtNodeId)) continue;
      const srcTaints = predicateTaints.get(e.srcNodeId);
      if (!srcTaints?.size) continue;
      for (const taintId of srcTaints) {
        // Taint X is consumed when this edge goes to the predicatePort of op X
        const taintedOp = opNds.find(n => n.id === taintId);
        const predPort = taintedOp ? EXPR_NODE_DEFS[taintedOp.category]?.predicatePort : undefined;
        const isConsumed = e.tgtNodeId === taintId && !!predPort && e.tgtFieldPath === predPort;
        if (isConsumed) continue;
        if (!predicateTaints.has(e.tgtNodeId)) predicateTaints.set(e.tgtNodeId, new Set());
        if (!predicateTaints.get(e.tgtNodeId)!.has(taintId)) {
          predicateTaints.get(e.tgtNodeId)!.add(taintId);
          predChanged = true;
        }
      }
    }
  }

  for (const e of opEdges) {
    // Skip resource→resource self-loops, but allow resource→forEachTaintedOp (op nodes are safe as targets).
    if (!opNdIds.has(e.srcNodeId) && opTargetRegularNodes.has(e.srcNodeId) && !opNdIds.has(e.tgtNodeId)) continue;
    if (forEachTaintedOps.has(e.srcNodeId) && !opNdIds.has(e.tgtNodeId)) continue;
    // Skip output edges that feed back into a predicate op's pred/expr port. These back-edges
    // (e.g. compare.output → exists.pred) form a cycle with the forward var: edges
    // (exists.var:field → compare), causing Kahn's BFS to leave both nodes unassigned (layer 0).
    // We keep all other output edges (e.g. mapOp.output → existsOp.collection for chaining).
    if (e.srcFieldPath === 'output' && opNdIds.has(e.tgtNodeId)) {
      const tgtOp = opNds.find(n => n.id === e.tgtNodeId);
      const predPort = tgtOp ? EXPR_NODE_DEFS[tgtOp.category]?.predicatePort : undefined;
      if (predPort && e.tgtFieldPath === predPort) continue;
    }
    const dk = `${e.srcNodeId}→${e.tgtNodeId}`;
    if (!depsSeen.has(dk)) { depsSeen.add(dk); rawDeps.push({ source: e.srcNodeId, target: e.tgtNodeId }); }
  }

  // Include op nodes in the combined layout so they sit between their source and target nodes.
  const opNdH = (n: ExprNode) => {
    if (n.category === 'raw-template') return n.h ?? RAW_TEMPLATE_NODE_H;
    const def = EXPR_NODE_DEFS[n.category];
    const portCount = n.portCount ?? (def?.inputs?.length ?? 2);
    const varFieldRows = def?.hasPredicate ? exprNodeVarFieldExtraRows(n.varFields ?? []) : 0;
    return exprNodeH(portCount) + varFieldRows * EXPR_NODE_PORT_H;
  };
  const allForLayout = [
    ...nodes.map(n => ({ id: n.id, h: n.h })),
    ...opNds.map(n => ({ id: n.id, h: opNdH(n) })),
  ];

  const pos = dagLayout(allForLayout, rawDeps);
  for (const n of nodes) { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y; } }
  const positionedExprNodes = opNds.map(n => {
    const p = pos.get(n.id);
    const taints: string[] = [];
    if (forEachTaintedOps.has(n.id)) taints.push('forEach');
    const predTaints = predicateTaints.get(n.id);
    if (predTaints) taints.push(...predTaints);
    return { ...(p ? { ...n, x: p.x, y: p.y } : n), ...(taints.length ? { taints } : {}) };
  });
  return { nodes, edges, exprNodes: positionedExprNodes, extraEdges: opEdges };
}

// ── Edge geometry ─────────────────────────────────────────────────────────────

export function rowPortY(node: GraphNode, rowIdx: number, topOffset = 0): number {
  return node.y + NODE_HDR_H + topOffset + rowIdx * NODE_ROW_H + NODE_ROW_H / 2;
}

/** Returns NODE_ROW_H if this kro-resource node will show the section-add bar at the top when expanded.
 *  In read-only mode the bar is never rendered, so the offset is 0 — passing
 *  `readOnly: true` keeps edge Y-coordinates aligned with the rendered card. */
export function sectionAddBarOffset(node: GraphNode, readOnly = false): number {
  if (readOnly || node.type !== 'kro-resource') return 0;
  const sections = ['forEach', 'includeWhen', 'readyWhen'] as const;
  return sections.some(s => !node.rows.some(r => r.isSection && r.key === s)) ? NODE_ROW_H : 0;
}

export function srcPortY(src: GraphNode, portPath: string, topOffset = 0): number {
  // `portPath` was frozen at buildGraph time; the row's `outPort.path` is overlay-
  // mutable when the user toggles per-segment `?` markers. Compare without the
  // markers so the edge keeps anchoring to the right row.
  const want = stripOptionalMarkers(portPath);
  const idx = src.rows.findIndex(r => r.outPort && stripOptionalMarkers(r.outPort.path) === want);
  return idx >= 0 ? rowPortY(src, idx, topOffset) : src.y + (src.type === 'kro-resource' ? NODE_HDR_H / 2 : src.h / 2);
}

export function tgtPortY(tgt: GraphNode, edge: GraphEdge, topOffset = 0): number {
  // Prefer the exact target row identified by `edge.tgtFieldPath` — that handles
  // the case where multiple rows on the same node share the same `inPort` key
  // (two fields with the same `${ref.path}` CEL expression).
  if (edge.tgtFieldPath) {
    const exact = tgt.rows.findIndex(r => r.fieldPath === edge.tgtFieldPath);
    if (exact >= 0) return rowPortY(tgt, exact, topOffset);
  }
  // Fallback: legacy inPort-key match. Only match inPort rows: GraphEdges are
  // created only for exact single-ref fields (same condition as buildTemplateRows
  // inPort case), so there is always a matching inPort row. Matching segments rows
  // would land on a composed/multi-segment field that uses the same source ref —
  // producing a spurious extra arrow alongside the correct op-node edge.
  // Strip `?` markers from both sides so the edge keeps anchoring after the user
  // toggles per-segment optionality via the popover.
  const want = stripOptionalMarkers(edge.tgtPortKey);
  const idx = tgt.rows.findIndex(r => r.inPort && stripOptionalMarkers(`${r.inPort.ref}::${r.inPort.srcPath}`) === want);
  return idx >= 0 ? rowPortY(tgt, idx, topOffset) : tgt.y + tgt.h / 2;
}

export function extraPortY(node: GraphNode, fieldPath: string, topOffset = 0): number {
  // Strip `?` markers for the same reason as srcPortY/tgtPortY.
  const want = stripOptionalMarkers(fieldPath);
  const idx = node.rows.findIndex(r => stripOptionalMarkers(r.fieldPath ?? '') === want);
  return idx >= 0 ? rowPortY(node, idx, topOffset) : node.y + node.h / 2;
}

export function makeBezier(sx: number, sy: number, tx: number, ty: number): string {
  const d = Math.max(Math.abs(tx - sx) * 0.45, 48);
  return `M ${sx} ${sy} C ${sx + d} ${sy} ${tx - d} ${ty} ${tx} ${ty}`;
}

export function bezierPath(src: GraphNode, tgt: GraphNode, edge: GraphEdge, srcTopOffset = 0, tgtTopOffset = 0): string {
  return makeBezier(src.x + src.w, srcPortY(src, edge.srcPortPath, srcTopOffset), tgt.x, tgtPortY(tgt, edge, tgtTopOffset));
}

/**
 * Canvas coordinates of the output port of an op node for an extra edge.
 * Handles both var-field ports and the standard output port.
 */
export function exprNodeSrcCoords(node: ExprNode, srcFieldPath: string): { sx: number; sy: number } {
  const sx = node.x + EXPR_NODE_W;
  let sy: number;
  if (srcFieldPath.startsWith(VAR_FIELD_PREFIX)) {
    const vp = srcFieldPath.slice(VAR_FIELD_PREFIX.length);
    const def = EXPR_NODE_DEFS[node.category];
    const vpi = def?.inputs.findIndex(p => p.name === 'var') ?? 0;
    const vfs = node.varFields ?? [];
    sy = node.y + EXPR_NODE_HDR_H + varFieldLeafRow(vfs, vpi, Math.max(0, vfs.indexOf(vp))) * EXPR_NODE_PORT_H + EXPR_NODE_PORT_H / 2;
  } else {
    const def = EXPR_NODE_DEFS[node.category];
    const pc = def?.variadic ? (node.portCount ?? def.inputs.length) : (def?.inputs.length ?? 1);
    sy = exprNodeOutputPortY(node, pc);
  }
  return { sx, sy };
}

/**
 * Canvas coordinates of an input port of an op node for an extra edge.
 */
export function exprNodeTgtCoords(node: ExprNode, tgtFieldPath: string): { tx: number; ty: number } {
  const def = EXPR_NODE_DEFS[node.category];
  const portIdx = def?.variadic
    ? (tgtFieldPath.charCodeAt(0) - 65)
    : (def?.inputs.findIndex(p => p.name === tgtFieldPath) ?? 0);
  const tgtVarPortIdx = def?.hasPredicate ? def.inputs.findIndex(p => p.name === 'var') : -1;
  const tgtOffset = tgtVarPortIdx >= 0 && portIdx > tgtVarPortIdx
    ? buildVarFieldRows(node.varFields ?? []).length * EXPR_NODE_PORT_H
    : 0;
  return { tx: node.x, ty: exprNodeInputPortY(node, portIdx) + tgtOffset };
}
