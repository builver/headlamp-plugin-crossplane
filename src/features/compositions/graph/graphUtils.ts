import { findCelRefs } from './celUtils';
import { EDGE_TYPE_FOR, ENV_NODE_ID, HEADER_H, HG, NODE_MIN_H, nodeH, NW, refToNodeId,ROW_H, SCHEMA_NODE_ID, VG } from './constants';
import { buildTemplateRows, getDeepPath, insertRowAtPath } from './rowUtils';
import { CelRef, GEdge, GNode, NodeType, OutPort } from './types';

// ── DAG layout ─────────────────────────────────────────────────────────────────

export function dagLayout(
  nodesIn: Array<{ id: string; h: number }>,
  deps: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const ids  = nodesIn.map(n => n.id);
  const hMap = new Map(nodesIn.map(n => [n.id, n.h]));
  const inDeg = new Map<string, number>(ids.map(id => [id, 0]));
  const out   = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const { source: s, target: t } of deps) {
    if (inDeg.has(t) && out.has(s)) { inDeg.set(t, inDeg.get(t)! + 1); out.get(s)!.push(t); }
  }
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
  const colH = (ids2: string[]) => ids2.reduce((s, id) => s + (hMap.get(id) ?? NODE_MIN_H) + VG, -VG);
  const maxH = Math.max(...[...byLayer.values()].map(colH), 0);
  const pos  = new Map<string, { x: number; y: number }>();
  for (const [l, lIds] of byLayer) {
    let curY = (maxH - colH(lIds)) / 2;
    for (const id of lIds) { pos.set(id, { x: l * (NW + HG), y: curY }); curY += (hMap.get(id) ?? NODE_MIN_H) + VG; }
  }
  return pos;
}

// ── Graph builder ──────────────────────────────────────────────────────────────

function hasCelPattern(obj: unknown, pattern: RegExp): boolean {
  if (typeof obj === 'string') return pattern.test(obj);
  if (Array.isArray(obj)) return obj.some(v => hasCelPattern(v, pattern));
  if (obj !== null && typeof obj === 'object') return Object.values(obj).some(v => hasCelPattern(v, pattern));
  return false;
}

export function buildGraph(input: any): { nodes: GNode[]; edges: GEdge[] } {
  const resources: any[] = input?.resources ?? [];
  if (!resources.length) return { nodes: [], edges: [] };
  const hasSchema = hasCelPattern(resources, /\$\{schema\./);
  const hasEnv    = hasCelPattern(resources, /\$\{env\./);
  const resIds = new Set(resources.map((r: any) => r.id as string));
  const known  = new Set<string>([...resIds]);
  if (hasSchema) known.add('schema');
  if (hasEnv)    known.add('env');

  type AllRef = CelRef & { targetId: string; srcNodeId: string };
  const allRefs: AllRef[] = [];
  for (const res of resources)
    for (const ref of findCelRefs(res.template ?? null, known)) {
      const sn = refToNodeId(ref.srcRef);
      allRefs.push({ ...ref, targetId: res.id as string, srcNodeId: sn });
    }

  const outPortsMap = new Map<string, Map<string, OutPort>>();
  for (const r of allRefs) {
    if (!outPortsMap.has(r.srcNodeId)) outPortsMap.set(r.srcNodeId, new Map());
    const m = outPortsMap.get(r.srcNodeId)!;
    if (!m.has(r.srcPath)) m.set(r.srcPath, { path: r.srcPath, short: r.srcShort });
  }

  const makeNode = (id: string, type: NodeType, label: string, template: any | null, sublabel?: string): GNode => {
    const opArr   = [...(outPortsMap.get(id) ?? new Map()).values()]
      .sort((a, b) => a.path.localeCompare(b.path));
    const opPaths = new Set(opArr.map(p => p.path));
    const visited = new Set<string>();
    let rows = template ? buildTemplateRows(template, known, opPaths, visited) : [];
    // Insert unvisited outPort rows alphabetically alongside template rows.
    // Look up the actual primitive value so it can be displayed even without a template row.
    for (const op of opArr.filter(p => !visited.has(p.path))) {
      const raw = template ? getDeepPath(template, op.path) : undefined;
      const value = raw !== null && raw !== undefined && typeof raw !== 'object' ? String(raw) : undefined;
      rows = insertRowAtPath(rows, op.path, { outPort: op, value });
    }
    return { id, type, label, sublabel, rows, x: 0, y: 0, w: NW, h: nodeH(rows) };
  };

  const nodes: GNode[] = [];
  if (hasSchema) nodes.push(makeNode(SCHEMA_NODE_ID, 'schema', 'schema', null));
  if (hasEnv) {
    const envReqs: any[] = input?.requirements?.requiredResources ?? [];
    const envNames = [...new Set<string>(envReqs.map((r: any) => r.requirementName).filter(Boolean))].join(', ');
    nodes.push(makeNode(ENV_NODE_ID, 'env', envNames || 'env', null));
  }
  for (const res of resources) {
    if (res.externalRef) {
      // Build a display-only template from the externalRef fields so rows show apiVersion, kind, and name/selector.
      const displayTemplate = {
        apiVersion: res.externalRef.apiVersion,
        kind: res.externalRef.kind,
        ...(res.externalRef.metadata ? { metadata: res.externalRef.metadata } : {}),
      };
      nodes.push(makeNode(res.id, 'kro-ref', res.id, displayTemplate));
    } else {
      nodes.push(makeNode(res.id, 'kro-resource', res.id, res.template ?? null));
    }
  }

  const edgesSeen = new Set<string>(); const edges: GEdge[] = [];
  const rawDeps: Array<{ source: string; target: string }> = []; const depsSeen = new Set<string>();
  for (const r of allRefs) {
    const eid2 = `${r.srcNodeId}::${r.srcPath}→${r.targetId}`;
    if (!edgesSeen.has(eid2)) {
      edgesSeen.add(eid2);
      edges.push({ id: eid2, source: r.srcNodeId, target: r.targetId,
        srcPortPath: r.srcPath, tgtPortKey: `${r.srcRef}::${r.srcPath}`,
        type: (EDGE_TYPE_FOR[r.srcRef] ?? 'kro-dep') as GEdge['type'] });
    }
    const dk = `${r.srcNodeId}→${r.targetId}`;
    if (!depsSeen.has(dk)) { depsSeen.add(dk); rawDeps.push({ source: r.srcNodeId, target: r.targetId }); }
  }

  const pos = dagLayout(nodes.map(n => ({ id: n.id, h: n.h })), rawDeps);
  for (const n of nodes) { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y; } }
  return { nodes, edges };
}

// ── Edge geometry ─────────────────────────────────────────────────────────────

export function rowPortY(node: GNode, rowIdx: number): number {
  return node.y + HEADER_H + rowIdx * ROW_H + ROW_H / 2;
}

export function srcPortY(src: GNode, portPath: string): number {
  const idx = src.rows.findIndex(r => r.outPort?.path === portPath);
  return idx >= 0 ? rowPortY(src, idx) : src.y + (src.type === 'kro-resource' ? HEADER_H / 2 : src.h / 2);
}

export function tgtPortY(tgt: GNode, portKey: string): number {
  const [pRef, pPath] = portKey.split('::');
  const idx = tgt.rows.findIndex(r => {
    if (r.inPort) return `${r.inPort.ref}::${r.inPort.srcPath}` === portKey;
    if (r.segments) return r.segments.some(s => s.kind === 'cel' && s.srcRef === pRef && s.srcPath === pPath);
    return false;
  });
  return idx >= 0 ? rowPortY(tgt, idx) : tgt.y + tgt.h / 2;
}

export function extraPortY(node: GNode, fieldPath: string): number {
  const idx = node.rows.findIndex(r => r.fieldPath === fieldPath);
  return idx >= 0 ? rowPortY(node, idx) : node.y + node.h / 2;
}

export function makeBezier(sx: number, sy: number, tx: number, ty: number): string {
  const d = Math.max(Math.abs(tx - sx) * 0.45, 48);
  return `M ${sx} ${sy} C ${sx + d} ${sy} ${tx - d} ${ty} ${tx} ${ty}`;
}

export function bezierPath(src: GNode, tgt: GNode, edge: GEdge): string {
  return makeBezier(src.x + src.w, srcPortY(src, edge.srcPortPath), tgt.x, tgtPortY(tgt, edge.tgtPortKey));
}
