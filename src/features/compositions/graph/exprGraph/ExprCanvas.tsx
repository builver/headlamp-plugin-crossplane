import { Icon } from '@iconify/react';
import { Box, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_CFG, refAccent, USER_C_DARK, USER_C_LIGHT } from '../constants';
import { makeBezier } from '../graphUtils';
import { SegmentedControl } from '../NodeCard';
import { EditingRow, NodeType } from '../types';
import { exprNodeCardH, mkExprId, toCelTemplate } from './exprGraphUtils';
import { EXPR_NODE_DEFS } from './ExprNodeDefs';
import { ExprEdge, ExpressionGraph, ExprNode, NodeDef, PickerEntry, PortDef } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the effective input port list for a node, expanding variadic nodes by portCount. */
function effectivePorts(node: ExprNode, def: NodeDef): PortDef[] {
  if (!def.variadic) return def.inputs;
  const count = Math.max(def.inputs.length, node.portCount ?? 0);
  if (count <= def.inputs.length) return def.inputs;
  const extra: PortDef[] = [];
  for (let i = def.inputs.length; i < count; i++) {
    const name = String.fromCharCode(65 + i);
    extra.push({ name, label: name, type: 'string' });
  }
  return [...def.inputs, ...extra];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPR_NODE_W = 140;
const EXPR_DOT    = 8;

function outPortX(node: ExprNode): number { return node.x + EXPR_NODE_W; }
function outPortY(node: ExprNode): number { return node.y + exprNodeCardH(node) / 2; }

function inPortX(node: ExprNode): number { return node.x; }
function inPortY(node: ExprNode, portIdx: number): number {
  if (node.kind === 'operation') return node.y + 22 + portIdx * 20 + 10;
  return node.y + exprNodeCardH(node) / 2;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ExprCanvasProps {
  editingRow: EditingRow;
  initialGraph: ExpressionGraph;
  panelX: number;
  panelY: number;
  pickerSuggestions: PickerEntry[];
  onSave: (template: string) => void;
  onCancel: () => void;
  dark: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExprCanvas({
  editingRow, initialGraph, panelX, panelY, pickerSuggestions, onSave, onCancel, dark,
}: ExprCanvasProps) {
  const userC = dark ? USER_C_DARK : USER_C_LIGHT;

  // Deep-copy initialGraph so internal edits don't mutate the parent's version
  const [graph, setGraph] = useState<ExpressionGraph>(() => ({
    nodes: initialGraph.nodes.map(n => ({ ...n })),
    edges: [...initialGraph.edges],
  }));

  const [miniPan,   setMiniPan]   = useState({ x: 10, y: 10 });
  const [miniScale, setMiniScale] = useState(1.0);
  const miniPanRef   = useRef(miniPan);
  const miniScaleRef = useRef(miniScale);
  useEffect(() => { miniPanRef.current = miniPan; });
  useEffect(() => { miniScaleRef.current = miniScale; });

  // Drawing an edge from an output port
  const [drawingEdge, setDrawingEdge] = useState<{ srcNodeId: string; cx: number; cy: number } | null>(null);

  // Ref picker (for "Add Ref" button)
  const [showPicker,  setShowPicker]  = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const miniRef   = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart  = useRef({ ox: 0, oy: 0, mx: 0, my: 0 });
  const dragRef   = useRef<{ id: string; ox: number; oy: number; mx: number; my: number } | null>(null);

  const screenToMini = useCallback((sx: number, sy: number) => {
    const r = miniRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: (sx - r.left - miniPanRef.current.x) / miniScaleRef.current,
      y: (sy - r.top  - miniPanRef.current.y) / miniScaleRef.current,
    };
  }, []);

  // Wheel zoom on mini-canvas
  useEffect(() => {
    const el = miniRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const prev = miniScaleRef.current;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const next = Math.max(0.25, Math.min(3, prev * Math.pow(0.999, dy)));
      const ratio = next / prev;
      miniScaleRef.current = next;
      setMiniScale(next);
      setMiniPan(p => ({ x: px - (px - p.x) * ratio, y: py - (py - p.y) * ratio }));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const nodeMap = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph.nodes]);
  const edgesByTgt = useMemo(() => {
    const m = new Map<string, ExprEdge[]>();
    for (const e of graph.edges) {
      if (!m.has(e.tgtNodeId)) m.set(e.tgtNodeId, []);
      m.get(e.tgtNodeId)!.push(e);
    }
    return m;
  }, [graph.edges]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const onMiniDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { ox: miniPanRef.current.x, oy: miniPanRef.current.y, mx: e.clientX, my: e.clientY };
    e.stopPropagation();
  }, []);

  const onMiniMove = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.mx;
      const dy = e.clientY - panStart.current.my;
      setMiniPan({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
    }
    if (dragRef.current) {
      const cp = screenToMini(e.clientX, e.clientY);
      const { id, ox, oy, mx, my } = dragRef.current;
      setGraph(g => ({
        ...g,
        nodes: g.nodes.map(n => n.id === id ? { ...n, x: ox + cp.x - mx, y: oy + cp.y - my } : n),
      }));
    }
    if (drawingEdge) {
      const cp = screenToMini(e.clientX, e.clientY);
      setDrawingEdge(d => d ? { ...d, cx: cp.x, cy: cp.y } : null);
    }
  }, [drawingEdge, screenToMini]);

  const onMiniUp = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    isPanning.current = false;
    dragRef.current = null;
    setDrawingEdge(null);
  }, []);

  const onNodeDown = useCallback((e: MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = nodeMap.get(nodeId); if (!node) return;
    const cp = screenToMini(e.clientX, e.clientY);
    dragRef.current = { id: nodeId, ox: node.x, oy: node.y, mx: cp.x, my: cp.y };
  }, [nodeMap, screenToMini]);

  const onOutPortDown = useCallback((e: MouseEvent, srcNodeId: string) => {
    e.stopPropagation();
    const cp = screenToMini(e.clientX, e.clientY);
    setDrawingEdge({ srcNodeId, cx: cp.x, cy: cp.y });
  }, [screenToMini]);

  const onInPortUp = useCallback((e: MouseEvent, tgtNodeId: string, tgtPort: string) => {
    e.stopPropagation();
    if (!drawingEdge || drawingEdge.srcNodeId === tgtNodeId) {
      setDrawingEdge(null); return;
    }
    setGraph(g => ({
      ...g,
      edges: [
        ...g.edges.filter(ed => !(ed.tgtNodeId === tgtNodeId && ed.tgtPort === tgtPort)),
        { id: mkExprId('e'), srcNodeId: drawingEdge.srcNodeId, tgtNodeId, tgtPort },
      ],
    }));
    setDrawingEdge(null);
  }, [drawingEdge]);

  const deleteNode = useCallback((nodeId: string) => {
    setGraph(g => ({
      nodes: g.nodes.filter(n => n.id !== nodeId),
      edges: g.edges.filter(e => e.srcNodeId !== nodeId && e.tgtNodeId !== nodeId),
    }));
  }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    setGraph(g => ({ ...g, edges: g.edges.filter(e => e.id !== edgeId) }));
  }, []);

  const addOpNode = useCallback((category: string) => {
    const def = EXPR_NODE_DEFS[category]; if (!def) return;
    const id = mkExprId('op');
    setGraph(g => ({
      ...g,
      nodes: [...g.nodes, { id, kind: 'operation' as const, category, op: def.defaultOp, x: 190, y: 80 }],
    }));
  }, []);

  const addRefNode = useCallback((entry: PickerEntry) => {
    const id = mkExprId('ref');
    setGraph(g => ({
      ...g,
      nodes: [...g.nodes, {
        id, kind: 'ref' as const, x: 10, y: 80,
        nodeRef: entry.nodeRef, srcNodeId: entry.nodeId,
        fieldPath: entry.fieldPath, fieldType: entry.fieldType,
      }],
    }));
    setShowPicker(false); setPickerQuery('');
  }, []);

  const addLiteralNode = useCallback(() => {
    const id = mkExprId('lit');
    setGraph(g => ({
      ...g,
      nodes: [...g.nodes, { id, kind: 'literal' as const, x: 10, y: 80, value: '', valueType: 'string' as const }],
    }));
  }, []);

  // ── Edge rendering ───────────────────────────────────────────────────────────

  const edges = graph.edges.map(e => {
    const src = nodeMap.get(e.srcNodeId);
    const tgt = nodeMap.get(e.tgtNodeId);
    if (!src || !tgt) return null;

    let tgtPortIdx = 0;
    if (tgt.kind === 'operation') {
      const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === tgt.category);
      const ports = def ? effectivePorts(tgt, def) : [];
      tgtPortIdx = Math.max(0, ports.findIndex(p => p.name === e.tgtPort));
    }

    const sx = outPortX(src);
    const sy = outPortY(src);
    const tx = inPortX(tgt);
    const ty = inPortY(tgt, tgtPortIdx);
    const d = makeBezier(sx, sy, tx, ty);
    const mx = (sx + tx) / 2; const my = (sy + ty) / 2;

    return (
      <g key={e.id}>
        <path d={d} fill="none" stroke={userC} strokeWidth={1.5} strokeOpacity={0.7} />
        <path d={d} fill="none" stroke="transparent" strokeWidth={10} style={{ pointerEvents: 'all', cursor: 'pointer' }}
          onClick={ev => { ev.stopPropagation(); deleteEdge(e.id); }} />
        <circle cx={mx} cy={my} r={3} fill={userC} opacity={0.4} style={{ pointerEvents: 'none' }} />
      </g>
    );
  });

  // ── Node card rendering ──────────────────────────────────────────────────────

  const renderNode = (node: ExprNode) => {
    const h = exprNodeCardH(node);
    const isOutput = node.kind === 'output';

    // Output port dot (right side, except output node)
    const outDot = !isOutput ? (
      <div role="button" tabIndex={-1}
        style={{
          position: 'absolute', right: -EXPR_DOT / 2, top: h / 2 - EXPR_DOT / 2,
          width: EXPR_DOT, height: EXPR_DOT, borderRadius: '50%',
          background: userC, border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`,
          cursor: 'crosshair', zIndex: 2,
        }}
        onMouseDown={e => onOutPortDown(e, node.id)}
      />
    ) : null;

    // Input port dot(s) (left side)
    const inDots = (() => {
      if (node.kind === 'ref' || node.kind === 'literal') return null;
      if (node.kind === 'output') {
        return (
          <div role="button" tabIndex={-1}
            style={{
              position: 'absolute', left: -EXPR_DOT / 2, top: h / 2 - EXPR_DOT / 2,
              width: EXPR_DOT, height: EXPR_DOT, borderRadius: '50%',
              background: userC, border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`,
              cursor: 'crosshair', zIndex: 2,
            }}
            onMouseUp={e => onInPortUp(e, node.id, 'input')}
          />
        );
      }
      // operation
      const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === node.category);
      return def ? effectivePorts(node, def).map((port, pi) => (
        <div key={port.name} role="button" tabIndex={-1}
          style={{
            position: 'absolute', left: -EXPR_DOT / 2, top: 22 + pi * 20 + 10 - EXPR_DOT / 2,
            width: EXPR_DOT, height: EXPR_DOT, borderRadius: '50%',
            background: (edgesByTgt.get(node.id) ?? []).some(e => e.tgtPort === port.name) ? userC : (dark ? '#555' : '#bbb'),
            border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`,
            cursor: 'crosshair', zIndex: 2,
          }}
          onMouseUp={e => onInPortUp(e, node.id, port.name)}
        />
      )) : null;
    })();

    return (
      <div key={node.id}
        role="button" tabIndex={0}
        style={{
          position: 'absolute', left: node.x, top: node.y,
          width: EXPR_NODE_W, height: h, cursor: 'grab',
        }}
        onMouseDown={e => onNodeDown(e, node.id)}
        onKeyDown={e => { if (e.key === 'Delete' && !isOutput) deleteNode(node.id); }}
      >
        {outDot}
        {inDots}
        <Paper elevation={2} sx={{
          width: '100%', height: '100%',
          border: `1.5px solid ${alpha(userC, 0.4)}`,
          borderRadius: 1, overflow: 'hidden',
          bgcolor: dark ? alpha(userC, 0.1) : alpha(userC, 0.04),
          display: 'flex', flexDirection: 'column',
        }}>
          {node.kind === 'ref' && <RefNodeBody node={node} dark={dark}
            onToggleOptional={() => setGraph(g => ({
              ...g,
              nodes: g.nodes.map(n => {
                if (n.id !== node.id) return n;
                const fp = n.fieldPath ?? '';
                let newFp: string;
                if (fp.includes('?')) {
                  newFp = fp.replace(/\?/g, '');
                } else {
                  const lastDot = fp.lastIndexOf('.');
                  newFp = lastDot === -1 ? `?${fp}` : `${fp.slice(0, lastDot + 1)}?${fp.slice(lastDot + 1)}`;
                }
                return { ...n, fieldPath: newFp, optional: !n.optional };
              }),
            }))}
            onDelete={() => deleteNode(node.id)}
          />}
          {node.kind === 'literal' && <LiteralNodeBody node={node}
            onValueChange={v => setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === node.id ? { ...n, value: v } : n) }))}
            onDelete={() => deleteNode(node.id)}
          />}
          {node.kind === 'operation' && <OperationNodeBody node={node} dark={dark} userC={userC}
            onOpChange={op => setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === node.id ? { ...n, op } : n) }))}
            onDelete={() => deleteNode(node.id)}
            edgesByTgt={edgesByTgt}
          />}
          {node.kind === 'output' && <OutputNodeBody fieldPath={editingRow.fieldPath} userC={userC} />}
        </Paper>
      </div>
    );
  };

  // Drawing edge preview
  const drawingPath = (() => {
    if (!drawingEdge) return null;
    const src = nodeMap.get(drawingEdge.srcNodeId); if (!src) return null;
    return (
      <path
        d={makeBezier(outPortX(src), outPortY(src), drawingEdge.cx, drawingEdge.cy)}
        fill="none" stroke={userC} strokeWidth={1.5} strokeOpacity={0.5} strokeDasharray="4 3"
      />
    );
  })();

  const filteredPicker = useMemo(
    () => pickerSuggestions.filter(s =>
      !pickerQuery || `${s.nodeRef}.${s.fieldPath}`.toLowerCase().includes(pickerQuery.toLowerCase())
    ).slice(0, 40),
    [pickerSuggestions, pickerQuery]
  );

  return (
    <Paper elevation={6}
      sx={{
        position: 'absolute', left: panelX, top: panelY,
        width: 540, zIndex: 25,
        border: `1.5px solid ${userC}`, borderRadius: 1.5, overflow: 'visible',
        display: 'flex', flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
      onMouseDown={e => e.stopPropagation()}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onCancel(); }}
    >
      {/* Header */}
      <Box sx={{ px: 1.25, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.75,
        borderBottom: `1px solid ${alpha(userC, 0.18)}` }}>
        <Icon icon="mdi:vector-bezier" width={12} style={{ color: userC, flexShrink: 0 }} />
        <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, fontSize: '0.65rem', fontWeight: 600, color: userC }}>
          {editingRow.fieldPath}
        </Typography>
        <Typography variant="caption" sx={{ fontSize: '0.56rem', opacity: 0.45 }}>Expression Graph</Typography>
      </Box>

      {/* Mini-canvas */}
      <Box ref={miniRef}
        sx={{
          height: 260, position: 'relative', overflow: 'hidden',
          bgcolor: dark ? '#0e0e0e' : '#f5f5f8',
          backgroundImage: `radial-gradient(${dark ? '#2a2a2a' : '#c8c8d0'} 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
          cursor: drawingEdge ? 'crosshair' : 'grab',
        }}
        onMouseDown={onMiniDown}
        onMouseMove={onMiniMove}
        onMouseUp={onMiniUp}
        onMouseLeave={onMiniUp}
      >
        <div style={{ position: 'absolute', transform: `translate(${miniPan.x}px,${miniPan.y}px) scale(${miniScale})`, transformOrigin: '0 0' }}>
          <svg style={{ position: 'absolute', top: 0, left: 0, width: 800, height: 600, pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
            {edges}
            {drawingPath}
          </svg>
          {graph.nodes.map(renderNode)}
        </div>
      </Box>

      {/* Palette + actions */}
      <Box sx={{ px: 1, py: 0.6, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.4,
        borderTop: `1px solid ${alpha(userC, 0.15)}` }}>
        <Typography variant="caption" sx={{ fontSize: '0.56rem', opacity: 0.4, flexShrink: 0 }}>Add:</Typography>
        <Box component="button"
          onClick={() => { setShowPicker(p => !p); setPickerQuery(''); }}
          sx={{ fontFamily: 'monospace', fontSize: '0.6rem', px: 0.6, py: 0.2, borderRadius: 0.5,
            border: `1px solid ${alpha(userC, 0.3)}`, bgcolor: showPicker ? alpha(userC, 0.12) : 'transparent',
            color: userC, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.1) } }}>
          Ref
        </Box>
        <Box component="button" onClick={addLiteralNode}
          sx={{ fontFamily: 'monospace', fontSize: '0.6rem', px: 0.6, py: 0.2, borderRadius: 0.5,
            border: `1px solid ${alpha(userC, 0.3)}`, bgcolor: 'transparent',
            color: userC, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.1) } }}>
          Literal
        </Box>
        {Object.values(EXPR_NODE_DEFS).map(def => (
          <Box key={def.category} component="button" onClick={() => addOpNode(def.category)}
            sx={{ fontFamily: 'monospace', fontSize: '0.6rem', px: 0.6, py: 0.2, borderRadius: 0.5,
              border: `1px solid ${alpha(userC, 0.3)}`, bgcolor: 'transparent',
              color: userC, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.1) } }}>
            {def.label}
          </Box>
        ))}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
          <Box component="button" onClick={() => onSave(toCelTemplate(graph))}
            sx={{ border: `1px solid ${alpha(userC, 0.4)}`, borderRadius: 0.75, bgcolor: alpha(userC, 0.08),
              color: userC, fontSize: '0.64rem', px: 0.75, py: 0.25, cursor: 'pointer',
              '&:hover': { bgcolor: alpha(userC, 0.18) } }}>
            ✓ Save
          </Box>
          <Box component="button" onClick={onCancel}
            sx={{ border: `1px solid ${alpha(dark ? '#666' : '#ccc', 0.5)}`, borderRadius: 0.75,
              bgcolor: 'transparent', color: dark ? '#888' : '#555', fontSize: '0.64rem',
              px: 0.75, py: 0.25, cursor: 'pointer',
              '&:hover': { bgcolor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' } }}>
            ✕ Cancel
          </Box>
        </Box>
      </Box>

      {/* Ref picker dropdown */}
      {showPicker && (
        <Box sx={{
          position: 'absolute', bottom: 'calc(100% - 290px)', left: 0, width: 280,
          zIndex: 30, bgcolor: 'background.paper',
          border: `1px solid ${alpha(userC, 0.3)}`, borderRadius: 0.75, boxShadow: 4,
          display: 'flex', flexDirection: 'column', maxHeight: 200, overflow: 'hidden',
        }}
          onMouseDown={e => e.stopPropagation()}
        >
          <Box sx={{ px: 0.75, py: 0.4, borderBottom: `1px solid ${alpha(userC, 0.1)}` }}>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={pickerQuery}
              onChange={e => setPickerQuery(e.target.value)}
              placeholder="filter refs…"
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none',
                fontFamily: 'monospace', fontSize: '0.62rem', color: 'inherit' }}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { setShowPicker(false); } }}
            />
          </Box>
          <Box sx={{ overflowY: 'auto', flex: 1 }}>
            {filteredPicker.length === 0 && (
              <Typography variant="caption" sx={{ display: 'block', px: 1, py: 0.75, opacity: 0.35, fontSize: '0.6rem' }}>
                no matching fields
              </Typography>
            )}
            {filteredPicker.map(s => {
              const sColor = refAccent(s.nodeRef, dark, s.nodeType as NodeType);
              return (
                <Box key={`${s.nodeId}::${s.fieldPath}`}
                  onMouseDown={e => { e.preventDefault(); addRefNode(s); }}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.28,
                    cursor: 'pointer', '&:hover': { bgcolor: alpha(sColor, 0.07) } }}>
                  <Icon icon={NODE_CFG[s.nodeType as NodeType]?.icon ?? 'mdi:cube-outline'} width={9}
                    style={{ color: sColor, flexShrink: 0 }} />
                  <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.61rem', flex: 1 }}>
                    <Box component="span" sx={{ color: sColor, fontWeight: 600 }}>{s.nodeRef}</Box>
                    <Box component="span" sx={{ opacity: 0.5 }}>.</Box>
                    <Box component="span">{s.fieldPath}</Box>
                  </Typography>
                  {s.fieldType && (
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.54rem', opacity: 0.4, flexShrink: 0 }}>
                      {s.fieldType}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Paper>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RefNodeBody({ node, dark, onToggleOptional, onDelete }: {
  node: ExprNode; dark: boolean;
  onToggleOptional: () => void; onDelete: () => void;
}) {
  const color = refAccent(node.nodeRef ?? '', dark);
  return (
    <Box sx={{ px: 0.75, height: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ px: 0.4, py: 0.1, borderRadius: 0.4,
        bgcolor: alpha(color, 0.12), color, border: `1px solid ${alpha(color, 0.3)}`,
        fontFamily: 'monospace', fontSize: '0.55rem', fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>
        {node.nodeRef}
      </Box>
      <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.57rem', flex: 1, minWidth: 0 }}>
        {node.fieldPath?.replace(/\?/g, '')}
      </Typography>
      <Box component="span" role="button" tabIndex={-1}
        onClick={e => { e.stopPropagation(); onToggleOptional(); }}
        sx={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.6rem', lineHeight: 1, flexShrink: 0,
          color: node.optional ? color : (dark ? '#666' : '#bbb'),
          '&:hover': { color } }}>?</Box>
      <Box component="span" role="button" tabIndex={-1}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 0.9 }, fontSize: '0.65rem', lineHeight: 1, flexShrink: 0 }}>×</Box>
    </Box>
  );
}

function LiteralNodeBody({ node, onValueChange, onDelete }: {
  node: ExprNode;
  onValueChange: (v: string) => void; onDelete: () => void;
}) {
  return (
    <Box sx={{ px: 0.75, height: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {node.valueType === 'string' && (
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.4, lineHeight: 1, flexShrink: 0 }}>"</Typography>
      )}
      <input
        value={node.value ?? ''}
        onChange={e => onValueChange(e.target.value)}
        onMouseDown={e => e.stopPropagation()}
        placeholder={node.valueType === 'string' ? 'text' : node.valueType === 'number' ? '0' : 'true/false'}
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
          fontFamily: 'monospace', fontSize: '0.6rem', color: 'inherit', opacity: 0.85,
        }}
      />
      {node.valueType === 'string' && (
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.4, lineHeight: 1, flexShrink: 0 }}>"</Typography>
      )}
      <Box component="span" role="button" tabIndex={-1}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 0.9 }, fontSize: '0.65rem', lineHeight: 1, flexShrink: 0 }}>×</Box>
    </Box>
  );
}

function OperationNodeBody({ node, dark, userC, onOpChange, onDelete, edgesByTgt }: {
  node: ExprNode; dark: boolean; userC: string;
  onOpChange: (op: string) => void; onDelete: () => void;
  edgesByTgt: Map<string, ExprEdge[]>;
}) {
  const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === node.category);
  if (!def) return null;
  const inEdges = edgesByTgt.get(node.id) ?? [];
  return (
    <Box sx={{ px: 0.75, py: 0.4, display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      {/* Header with op switcher + delete */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mb: 0.3 }}>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.56rem', opacity: 0.55, flexShrink: 0 }}>
          {def.label}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <SegmentedControl
            options={def.ops.map(o => ({ value: o.op, label: o.label }))}
            value={node.op ?? def.defaultOp}
            onChange={onOpChange}
            py={0.1}
          />
        </Box>
        <Box component="span" role="button" tabIndex={-1}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 0.9 }, fontSize: '0.65rem', lineHeight: 1, flexShrink: 0 }}>×</Box>
      </Box>
      {/* Input port labels */}
      {effectivePorts(node, def).map(port => {
        const connected = inEdges.some(e => e.tgtPort === port.name);
        return (
          <Box key={port.name} sx={{ height: 20, display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{
              fontFamily: 'monospace', fontSize: '0.54rem', pl: 0.5,
              color: connected ? userC : (dark ? '#666' : '#bbb'),
              opacity: connected ? 1 : 0.5,
            }}>
              {port.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function OutputNodeBody({ fieldPath, userC }: {
  fieldPath: string; userC: string;
}) {
  return (
    <Box sx={{ px: 0.75, height: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Icon icon="mdi:arrow-right-circle-outline" width={11} style={{ color: userC, opacity: 0.6, flexShrink: 0 }} />
      <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.57rem', opacity: 0.7, flex: 1, minWidth: 0 }}>
        {fieldPath.split('.').pop()}
      </Typography>
    </Box>
  );
}
