import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGroupVersion } from '../../../components/map/apiPaths';
import { overlayRowWithTemplate } from './celUtils';
import {
  CANVAS_SIZE, DRAFT_NODE_ID, HEADER_H, K8S_BASE_FIELDS, K8S_MAP_PATHS,
  NODE_CFG, nodeH, nodeIdToRef, NW,
  OP_NODE_HDR_H, OP_NODE_PORT_H, OP_NODE_W, opNodeH, opNodeInputPortY, opNodeOutputPortY, opNodeVarFieldExtraRows, RAW_TEMPLATE_NODE_H,
  ROW_H, SCHEMA_NODE_ID, USER_C_DARK, USER_C_LIGHT, VAR_FIELD_PREFIX, varFieldLeafRow,
} from './constants';
import { EXPR_NODE_DEFS } from './exprGraph/ExprNodeDefs';
import { ConnectedPortInfo, ExprOpNodeCard } from './ExprOpNodeCard';
import { bezierPath, buildGraph, extraPortY, makeBezier, sectionAddBarOffset, srcPortY, tgtPortY } from './graphUtils';
import { DraftNodeCard, NodeCard } from './NodeCard';
import { OpNodePalette } from './OpNodePalette';
import { applyExtraEdgesToInput, applyFieldEditsToInput, buildTemplateRows, insertRowAtPath, makeLeafRow, reindexPathAfterDelete, removeRowAtPath } from './rowUtils';
import { getResApiVersion, getResKind } from './schemaUtils';
import { qualifiedPath, SECTION_DEFS, sectionOf, sectionRelPath } from './sectionDefs';
import {
  AddForm, Drawing, ExtraEdge, FieldEdit,
  FieldSuggestion, GEdge, GNode, HoverTarget, KindOption, NodeType, OpNode, PendingResource,
  SaveState, TokenHover, TRow,
} from './types';
import { typeCompat } from './typeUtils';
import { useCompositionSchemas } from './useCompositionSchemas';

// ── GraphCanvas ───────────────────────────────────────────────────────────────

export interface GraphCanvasProps {
  input: any;
  height?: number;
  compositionName: string;
  stepIndex: number;
  onDirtyChange?: (dirty: boolean) => void;
  /** openAPIV3Schema from the matching XRD, for schema-node field suggestions. */
  xrdSchema?: any;
  /** Maps "group/kind" → openAPIV3Schema for MRD-backed resource nodes. */
  mrdSchemaMap?: Map<string, any>;
  /** CRD-backed kind options for the "Add resource" form, pre-filtered by scope. */
  kindOptions?: KindOption[];
  /** Step-level requirements (requiredResources, requiredSchemas) from the pipeline step. */
  requirements?: any;
}

export function GraphCanvas({ input, height = 480, compositionName, stepIndex, onDirtyChange, xrdSchema, mrdSchemaMap, kindOptions = [], requirements }: GraphCanvasProps) {
  const theme        = useTheme();
  const dark         = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const userC        = dark ? USER_C_DARK : USER_C_LIGHT;

  const { nodes: initNodes, edges, opNodes: initOpNodes, extraEdges: initExtraEdges } = useMemo(() => buildGraph(input, requirements), [input, requirements]);

  const [nodes,        setNodes]        = useState<GNode[]>(initNodes);
  const [selected,     setSelected]     = useState<string | null>(null);
  const [active,       setActive]       = useState(false);
  const [drawing,           setDrawing]           = useState<Drawing | null>(null);
  const [hoverTarget,       setHoverTarget]       = useState<HoverTarget | null>(null);
  const [drawingHoverNodeId, setDrawingHoverNodeId] = useState<string | null>(null);
  const [extraEdges,        setExtraEdges]        = useState<ExtraEdge[]>(initExtraEdges);

  const [saveState,     setSaveState]     = useState<SaveState>('idle');
  const [tokenHover,    setTokenHover]    = useState<TokenHover | null>(null);
  const [fieldEdits,    setFieldEdits]    = useState<FieldEdit[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [opNodes,         setOpNodes]         = useState<OpNode[]>(initOpNodes);
  const [addOpForm,     setAddOpForm]     = useState<string | null>(null);
  const opDragId       = useRef<string | null>(null);
  const opDragOrigin   = useRef({ mx: 0, my: 0, nx: 0, ny: 0 });
  const opHasDragged   = useRef(false);
  const opResizeId   = useRef<string | null>(null);
  const opResizeOrigin = useRef({ my: 0, startH: 0 });
  const panRef        = useRef({ x: 0, y: 0 });
  const zoomRef       = useRef(1);
  const canvasDivRef  = useRef<HTMLDivElement>(null);
  const applyTransform = useCallback(() => {
    if (canvasDivRef.current) {
      canvasDivRef.current.style.transform = `translate(${panRef.current.x}px,${panRef.current.y}px) scale(${zoomRef.current})`;
    }
  }, []);
  const panOrigin     = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isPanDragging = useRef(false);
  const hasPanned     = useRef(false);
  const [dirtyOps,      setDirtyOps]      = useState(false);
  const [savedOpNodeIds, setSavedOpNodeIds] = useState<Set<string>>(new Set(initOpNodes.map(n => n.id)));
  const [savedEdgeIds,   setSavedEdgeIds]   = useState<Set<string>>(new Set(initExtraEdges.map(e => e.id)));
  const [pendingResources,  setPendingResources]  = useState<PendingResource[]>([]);
  const [pendingRemovals,   setPendingRemovals]   = useState<string[]>([]);
  const [addForm,           setAddForm]           = useState<AddForm | null>(null);
  const [confirmDelete,     setConfirmDelete]     = useState<string | null>(null);
  const isDirty = dirtyOps || fieldEdits.length > 0 || pendingResources.length > 0 || pendingRemovals.length > 0;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    try {
      // Pending resources must be merged first so that field edits and extra
      // edges targeting them can find the resource in the clone.
      let newInput: any = input;
      if (pendingResources.length > 0) {
        newInput = {
          ...newInput,
          resources: [
            ...(newInput.resources ?? []),
            ...pendingResources.map(r => {
              if (r.type === 'externalRef') {
                const metadata: Record<string, unknown> = {};
                if (r.name) metadata.name = r.name;
                else if (r.matchLabels && Object.keys(r.matchLabels).length)
                  metadata.selector = { matchLabels: r.matchLabels };
                return { id: r.id, externalRef: { apiVersion: r.apiVersion, kind: r.kind, metadata } };
              }
              return { id: r.id, template: { apiVersion: r.apiVersion, kind: r.kind, metadata: {} } };
            }),
          ],
        };
      }
      newInput = applyExtraEdgesToInput(newInput, extraEdges, opNodes);
      newInput = applyFieldEditsToInput(newInput, fieldEdits);
      if (pendingRemovals.length > 0) {
        const removeSet = new Set(pendingRemovals);
        newInput = { ...newInput, resources: (newInput.resources ?? []).filter((r: any) => !removeSet.has(r.id)) };
      }
      await ApiProxy.request(
        `/apis/apiextensions.crossplane.io/v1/compositions/${compositionName}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{ op: 'replace', path: `/spec/pipeline/${stepIndex}/input`, value: newInput }]),
        }
      );
      setSaveState('saved');
      setDirtyOps(false);
      setSavedOpNodeIds(new Set(opNodes.map(n => n.id)));
      setSavedEdgeIds(new Set(extraEdges.map(e => e.id)));
      setFieldEdits([]);
      setPendingResources([]);
      setPendingRemovals([]);
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      console.error('Failed to patch Composition:', err);
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3500);
    }
  }, [extraEdges, fieldEdits, pendingResources, opNodes, input, compositionName, stepIndex]);

  useEffect(() => {
    setNodes(initNodes);
    setExtraEdges(initExtraEdges); setFieldEdits([]); setPendingResources([]); setPendingRemovals([]);
    setAddForm(null); setConfirmDelete(null);
    setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null);
    setOpNodes(initOpNodes); setDirtyOps(false);
    setSavedOpNodeIds(new Set(initOpNodes.map(n => n.id)));
    setSavedEdgeIds(new Set(initExtraEdges.map(e => e.id)));
    opDragId.current = null; opResizeId.current = null;
  }, [initNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    effectiveXrdSchema,
    xrdSchemaDone,
    schemaKind,
    schemaApiVersion,
    schemaAttemptedKeys,
    xrdAllFields,
    xrdLeafFields,
    mrdFieldsCache,
    mrdMapPathsCache,
    mrdArrayPathsCache,
    mrdPreserveUnknownPathsCache,
  } = useCompositionSchemas({ compositionName, xrdSchema, mrdSchemaMap, input, pendingResources, requirements });

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const opNodesById = useMemo(() => new Map(opNodes.map(n => [n.id, n])), [opNodes]);

  const allMapPathsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of nodes) {
      if (n.type !== 'kro-resource' && n.type !== 'kro-ref') continue;
      const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
        ?? pendingResources.find(r => r.id === n.id);
      const apiVersion = getResApiVersion(res);
      const kind = getResKind(res);
      const group = getGroupVersion(apiVersion)[0];
      const mrdMaps = mrdMapPathsCache.get(`${group}/${kind}`) ?? new Set<string>();
      if (n.type === 'kro-ref') {
        map.set(n.id, new Set([...mrdMaps, 'metadata.selector.matchLabels']));
      } else {
        map.set(n.id, new Set([...K8S_MAP_PATHS, ...mrdMaps]));
      }
    }
    return map;
  }, [nodes, input, pendingResources, mrdMapPathsCache]);

  const allArrayPathsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of nodes) {
      if (n.type !== 'kro-resource' && n.type !== 'kro-ref') continue;
      const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
        ?? pendingResources.find(r => r.id === n.id);
      const apiVersion = getResApiVersion(res);
      const kind = getResKind(res);
      const group = getGroupVersion(apiVersion)[0];
      map.set(n.id, mrdArrayPathsCache.get(`${group}/${kind}`) ?? new Set<string>());
    }
    return map;
  }, [nodes, input, pendingResources, mrdArrayPathsCache]);

  const allPreserveUnknownPathsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of nodes) {
      if (n.type !== 'kro-resource' && n.type !== 'kro-ref') continue;
      const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
        ?? pendingResources.find(r => r.id === n.id);
      const apiVersion = getResApiVersion(res);
      const kind = getResKind(res);
      const group = getGroupVersion(apiVersion)[0];
      map.set(n.id, mrdPreserveUnknownPathsCache.get(`${group}/${kind}`) ?? new Set<string>());
    }
    return map;
  }, [nodes, input, pendingResources, mrdPreserveUnknownPathsCache]);

  /** Returns field path suggestions for the given node: schema from XRD/MRD, minus already-used paths.
   *  Leaf fields plus array container fields are returned. Array sub-fields (containers[].name) are
   *  expanded into per-item paths (containers.0.name) for each item already present in the node rows. */
  const getSuggestions = useCallback((nodeId: string): FieldSuggestion[] => {
    const node = nodeMap.get(nodeId);
    const rows = node?.rows ?? [];
    const usedPaths = new Set(rows.map(r => r.fieldPath).filter(Boolean) as string[]);
    const isLeaf = (s: FieldSuggestion) => s.type !== 'object' && s.type !== 'array';

    let allSugg: FieldSuggestion[];
    if (nodeId === SCHEMA_NODE_ID) {
      allSugg = xrdLeafFields;
    } else if (nodeMap.get(nodeId)?.type === 'env') {
      return [];
    } else {
      const res = (input?.resources ?? []).find((r: any) => r.id === nodeId)
        ?? pendingResources.find(r => r.id === nodeId);
      const apiVersion = getResApiVersion(res);
      const kind = getResKind(res);
      const group = getGroupVersion(apiVersion)[0];
      const fields = mrdFieldsCache.get(`${group}/${kind}`);

      // Leaf fields + array container fields (e.g. spec.containers) but not [].sub paths yet.
      // Schema fields take precedence: build deduped list with schema fields first, then
      // K8S_BASE_FIELDS as fallback (for resources whose schema wasn't fetched yet).
      // Exclude paths containing '[]' — those are array item sub-fields and are only surfaced
      // via the array expansion block below (once the array parent exists in rows).
      const leafFields = fields ? fields.filter(s => isLeaf(s) && !s.path.includes('[]')) : [];
      const arrayContainerFields = fields?.filter(s => s.type === 'array' && !s.path.includes('[]')) ?? [];
      const seen = new Set<string>();
      allSugg = [];
      for (const f of [...leafFields, ...arrayContainerFields]) {
        if (!seen.has(f.path)) { seen.add(f.path); allSugg.push(f); }
      }
      for (const f of K8S_BASE_FIELDS) {
        if (!seen.has(f.path)) { seen.add(f.path); allSugg.push(f); }
      }

      if (nodeMap.get(nodeId)?.type === 'kro-ref') {
        const p = 'metadata.selector.matchLabels';
        if (!seen.has(p)) allSugg.push({ path: p, type: 'object' });
      }

      // Expand array sub-field paths for existing array items (containers[].name → containers.0.name).
      // If the array parent row is present but has no items yet, suggest item 0 to guide the user.
      const arraySubFields = fields?.filter(s => s.path.includes('[].')) ?? [];
      for (const s of arraySubFields) {
        const bracketIdx = s.path.indexOf('[].');
        const arrayPath = s.path.slice(0, bracketIdx);
        const subField = s.path.slice(bracketIdx + 3);
        const arrayPrefix = arrayPath + '.';
        const indices = new Set<number>();
        for (const row of rows) {
          if (!row.fieldPath?.startsWith(arrayPrefix)) continue;
          const rest = row.fieldPath.slice(arrayPrefix.length);
          const seg = rest.split('.')[0];
          if (/^\d+$/.test(seg)) indices.add(parseInt(seg));
        }
        // If array parent exists in rows but has no items, hint at item 0
        if (indices.size === 0 && rows.some(r => r.fieldPath === arrayPath)) indices.add(0);
        for (const idx of indices) {
          allSugg.push({ path: `${arrayPath}.${idx}.${subField}`, type: s.type });
        }
      }

      // Sort by depth (fewer dots = shallower = earlier) then alphabetically so that e.g.
      // spec.replicas appears before metadata.managedFields[].apiVersion when no query is typed.
      allSugg.sort((a, b) => {
        const da = (a.path.match(/\./g) ?? []).length;
        const db = (b.path.match(/\./g) ?? []).length;
        return da - db || a.path.localeCompare(b.path);
      });
    }

    return allSugg.filter(s => !usedPaths.has(s.path));
  }, [input, pendingResources, xrdLeafFields, mrdFieldsCache, nodeMap]);

  const knownIds = useMemo(
    () => new Set(nodes.filter(n => n.id !== DRAFT_NODE_ID).map(n => nodeIdToRef(n.id))),
    [nodes]
  );


  /** Type of any field in any node — looks up the cached schema fields, bypassing the used-path filter.
   *  Array item sub-paths like containers.0.name are translated to containers[].name for lookup. */
  const getFieldType = useCallback((nodeId: string, fieldPath: string): string | undefined => {
    const secType = SECTION_DEFS[sectionOf(fieldPath)].fieldType(sectionRelPath(fieldPath));
    if (secType !== undefined) return secType;
    if (nodeId === SCHEMA_NODE_ID) {
      const normalizedPath = fieldPath.replace(/\?/g, '');
      return xrdAllFields.find(s => s.path === normalizedPath)?.type;
    }
    let apiVersion: string | undefined;
    let kind: string | undefined;
    if (nodeMap.get(nodeId)?.type === 'env') {
      const req = ((requirements ?? input?.requirements)?.requiredResources ?? [] as any[])
        .find((r: any) => r.requirementName === nodeId);
      apiVersion = req?.apiVersion;
      kind = req?.kind;
    } else {
      const res = (input?.resources ?? []).find((r: any) => r.id === nodeId)
        ?? pendingResources.find(r => r.id === nodeId);
      apiVersion = getResApiVersion(res);
      kind = getResKind(res);
    }
    const fields = mrdFieldsCache.get(`${getGroupVersion(apiVersion ?? '')[0]}/${kind ?? ''}`);
    if (!fields) return undefined;
    // Direct match first
    const direct = fields.find(s => s.path === fieldPath);
    if (direct) return direct.type;
    // Translate array item paths: containers.0.name → containers[].name
    const schemaPath = fieldPath.replace(/\.(\d+)\./g, '[].').replace(/\.(\d+)$/, '[]');
    return fields.find(s => s.path === schemaPath)?.type;
  }, [input, requirements, pendingResources, xrdAllFields, mrdFieldsCache, nodeMap]);

  /** Pre-built ConnectedPortInfo maps for every op node — avoids O(N×M) inline work in the render loop. */
  const connectedPortInfoByOpId = useMemo(() => {
    const result = new Map<string, Map<string, ConnectedPortInfo>>();
    for (const e of extraEdges) {
      if (!opNodesById.has(e.tgtNodeId)) continue;
      if (!result.has(e.tgtNodeId)) result.set(e.tgtNodeId, new Map());
      const srcOp = opNodesById.get(e.srcNodeId);
      let label: string; let type: string | undefined; let displayPath: string | undefined;
      if (srcOp && e.srcFieldPath.startsWith(VAR_FIELD_PREFIX)) {
        const varSubField = e.srcFieldPath.slice(VAR_FIELD_PREFIX.length);
        label = varSubField.split('.').pop() ?? varSubField;
        const varName = srcOp.literals['var'] ?? 'x';
        displayPath = `${varName}.${varSubField}`;
      } else if (srcOp) {
        label = EXPR_NODE_DEFS[srcOp.category]?.label ?? srcOp.category;
        type  = EXPR_NODE_DEFS[srcOp.category]?.outputType;
      } else {
        label = e.srcFieldPath.replace(/\?/g, '').split('.').pop() ?? e.srcFieldPath.replace(/\?/g, '');
        type  = getFieldType(e.srcNodeId, e.srcFieldPath);
      }
      const optional = srcOp ? undefined : e.srcFieldPath.includes('?');
      const srcNode = nodeMap.get(e.srcNodeId);
      const info: ConnectedPortInfo = { label, srcNodeId: e.srcNodeId, srcFieldPath: e.srcFieldPath, type, optional, displayPath, srcNodeType: srcNode?.type ?? 'kro-resource' };
      result.get(e.tgtNodeId)!.set(e.tgtFieldPath, info);
    }
    return result;
  }, [extraEdges, opNodesById, getFieldType, nodeMap]);

  /** For each regular (non-op) node: maps fieldPath → op-node label/type for op-output connections. Used to render VarPills on celExpr rows. */
  const opConnectedFieldsByNode = useMemo(() => {
    const result = new Map<string, Map<string, { label: string; type?: string; srcNodeId: string }>>();
    for (const e of extraEdges) {
      if (opNodesById.has(e.tgtNodeId)) continue;
      if (!opNodesById.has(e.srcNodeId) || e.srcFieldPath !== 'output') continue;
      const srcOp = opNodesById.get(e.srcNodeId)!;
      const label = EXPR_NODE_DEFS[srcOp.category]?.label ?? srcOp.category;
      const type = EXPR_NODE_DEFS[srcOp.category]?.outputType;
      if (!result.has(e.tgtNodeId)) result.set(e.tgtNodeId, new Map());
      result.get(e.tgtNodeId)!.set(e.tgtFieldPath, { label, type: type ?? undefined, srcNodeId: e.srcNodeId });
    }
    return result;
  }, [extraEdges, opNodesById]);

  const editedPaths = useMemo(
    () => new Set(fieldEdits.map(e => `${e.nodeId}::${e.fieldPath}`)),
    [fieldEdits]
  );

  const getEdgeTargetFieldPath = useCallback((edge: GEdge): string | undefined => {
    const tgt = nodeMap.get(edge.target);
    if (!tgt) return undefined;
    const row = tgt.rows.find(r => {
      if (r.inPort) return `${r.inPort.ref}::${r.inPort.srcPath}` === edge.tgtPortKey;
      if (r.segments) {
        const [pRef, pPath] = edge.tgtPortKey.split('::');
        return r.segments.some(s => s.kind === 'cel' && s.srcRef === pRef && s.srcPath === pPath);
      }
      return false;
    });
    return row?.fieldPath;
  }, [nodeMap]);

  const removeExistingEdge = useCallback((edge: GEdge) => {
    const fieldPath = getEdgeTargetFieldPath(edge);
    if (!fieldPath) return;
    setFieldEdits(prev => [
      ...prev.filter(e => !(e.nodeId === edge.target && e.fieldPath === fieldPath)),
      { nodeId: edge.target, fieldPath, template: '' },
    ]);
  }, [getEdgeTargetFieldPath]);

  /** Nodes with field-edit templates applied to their rows — used only for rendering. Excludes the draft node. */
  const nodesForDisplay = useMemo(() => {
    let result = nodes.filter(n => n.id !== DRAFT_NODE_ID);
    if (fieldEdits.length > 0) {
      result = result.map(node => {
        const nodeEditMap = new Map(
          fieldEdits.filter(e => e.nodeId === node.id).map(e => [e.fieldPath, e.template])
        );
        if (nodeEditMap.size === 0) return node;
        const overlaidRows = node.rows.map((row: TRow) =>
          row.fieldPath && nodeEditMap.has(row.fieldPath)
            ? overlayRowWithTemplate(row, nodeEditMap.get(row.fieldPath)!, knownIds)
            : row
        );
        return { ...node, rows: overlaidRows };
      });
    }
    if (schemaApiVersion || schemaKind) {
      result = result.map(n => {
        if (n.id !== SCHEMA_NODE_ID) return n;
        const infoRows: TRow[] = [
          ...(schemaApiVersion ? [makeLeafRow(0, 'apiVersion', 'apiVersion', schemaApiVersion, new Set())] : []),
          ...(schemaKind       ? [makeLeafRow(0, 'kind',       'kind',       schemaKind,       new Set())] : []),
        ];
        const newRows = [...infoRows, ...n.rows];
        return { ...n, rows: newRows, h: nodeH(newRows) };
      });
    }
    return result;
  }, [nodes, fieldEdits, knownIds, schemaApiVersion, schemaKind]);

  /** Node map keyed on display rows (includes injected info rows) — used for SVG edge Y calculations. */
  const displayNodeMap = useMemo(() => new Map(nodesForDisplay.map(n => [n.id, n])), [nodesForDisplay]);

  /**
   * For each regular (non-op) node: maps fieldPath → source accent color for ExtraEdges that
   * target that field but are not yet saved (so not reflected in row.inPort).
   * Inlines the color lookup (does not use nodeColor callback) to avoid TDZ ordering issues.
   */
  const activeInPathsByNode = useMemo(() => {
    const map = new Map<string, Map<string, { color: string; label: string; srcNodeId: string; srcFieldPath: string }>>();
    for (const e of extraEdges) {
      if (opNodes.some(n => n.id === e.tgtNodeId)) continue; // op-node inputs tracked separately
      let inner = map.get(e.tgtNodeId);
      if (!inner) { inner = new Map(); map.set(e.tgtNodeId, inner); }
      const srcIsOp = opNodes.some(n => n.id === e.srcNodeId);
      let color = userC;
      if (!srcIsOp) {
        const srcNode = displayNodeMap.get(e.srcNodeId);
        if (srcNode) {
          const cfg = NODE_CFG[srcNode.type];
          color = cfg ? (dark ? cfg.accentDark : cfg.accent) : userC;
        }
      }
      const label = e.srcFieldPath.replace(/\?/g, '').split('.').pop() ?? e.srcFieldPath.replace(/\?/g, '');
      inner.set(e.tgtFieldPath, { color, label, srcNodeId: e.srcNodeId, srcFieldPath: e.srcFieldPath });
    }
    return map;
  }, [extraEdges, opNodes, userC, displayNodeMap, dark]);

  /**
   * For each regular (non-op) node: set of fieldPaths that have outgoing ExtraEdges
   * (not yet reflected in row.outPort).
   */
  const activeOutPathsByNode = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of extraEdges) {
      if (opNodes.some(n => n.id === e.srcNodeId)) continue; // op-node outputs tracked separately
      let set = map.get(e.srcNodeId);
      if (!set) { set = new Set(); map.set(e.srcNodeId, set); }
      set.add(e.srcFieldPath);
    }
    return map;
  }, [extraEdges, opNodes]);

  /** Pre-computed suggestions per node — stable references so NodeCard.memo can short-circuit. */
  const allSuggestionsMap = useMemo(() => {
    const map = new Map<string, FieldSuggestion[]>();
    for (const n of nodesForDisplay) map.set(n.id, getSuggestions(n.id));
    return map;
  }, [nodesForDisplay, getSuggestions]);

  /**
   * All schema fields per node (including object-type fields), minus already-used paths.
   * Used exclusively by the inline field picker so it can show object containers like
   * spec.selector or spec.template as selectable options.
   */
  const allSchemaFieldsMap = useMemo(() => {
    const map = new Map<string, FieldSuggestion[]>();
    for (const n of nodesForDisplay) {
      if (n.type === 'draft') continue;
      const usedPaths = new Set(n.rows.map((r: TRow) => r.fieldPath).filter(Boolean) as string[]);
      let fields: FieldSuggestion[];
      if (n.id === SCHEMA_NODE_ID) {
        fields = xrdAllFields.filter(s => !usedPaths.has(s.path));
      } else if (n.type === 'env' || n.type === 'kro-ref') {
        continue;
      } else {
        const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
          ?? pendingResources.find(r => r.id === n.id);
        const apiVersion = getResApiVersion(res);
        const kind = getResKind(res);
        const group = getGroupVersion(apiVersion)[0];
        const schemaFields = mrdFieldsCache.get(`${group}/${kind}`);
        if (!schemaFields) continue;
        fields = schemaFields.filter(s => !usedPaths.has(s.path) && !s.path.includes('[]'));
      }
      map.set(n.id, fields);
    }
    return map;
  }, [nodesForDisplay, xrdAllFields, input, pendingResources, mrdFieldsCache]);

  /** Node IDs where schema was attempted but could not be loaded. */
  const noSchemaNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (xrdSchemaDone && !effectiveXrdSchema) ids.add(SCHEMA_NODE_ID);
    const envReqsList: any[] = (requirements ?? input?.requirements)?.requiredResources ?? [];
    for (const n of nodesForDisplay) {
      let apiVersion: string | undefined;
      let kind: string | undefined;
      if (n.type === 'env') {
        const req = envReqsList.find((r: any) => r.requirementName === n.id);
        apiVersion = req?.apiVersion; kind = req?.kind;
      } else if (n.type === 'kro-resource' || n.type === 'kro-ref') {
        const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
          ?? pendingResources.find(r => r.id === n.id);
        apiVersion = getResApiVersion(res); kind = getResKind(res);
      } else { continue; }
      if (!apiVersion || !kind) continue;
      const key = `${getGroupVersion(apiVersion)[0]}/${kind}`;
      if (schemaAttemptedKeys.has(key) && !mrdFieldsCache.has(key)) ids.add(n.id);
    }
    return ids;
  }, [xrdSchemaDone, effectiveXrdSchema, nodesForDisplay, input, requirements, pendingResources, schemaAttemptedKeys, mrdFieldsCache]);

  /** Field paths that are not present in the node's CRD/XRD schema. Only populated when schema is loaded. */
  const allUnknownPathsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const envReqsList: any[] = (requirements ?? input?.requirements)?.requiredResources ?? [];
    for (const n of nodesForDisplay) {
      if (n.type === 'draft') continue;
      // Determine whether the schema is loaded for this node
      let schemaLoaded = false;
      if (n.id === SCHEMA_NODE_ID) {
        schemaLoaded = xrdAllFields.length > 0;
      } else if (n.type === 'env') {
        const req = envReqsList.find((r: any) => r.requirementName === n.id);
        const apiVersion = req?.apiVersion as string | undefined;
        const kind = req?.kind as string | undefined;
        if (!apiVersion || !kind) continue;
        schemaLoaded = mrdFieldsCache.has(`${getGroupVersion(apiVersion)[0]}/${kind}`);
      } else {
        const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
          ?? pendingResources.find(r => r.id === n.id);
        const apiVersion = getResApiVersion(res);
        const kind = getResKind(res);
        const group = getGroupVersion(apiVersion)[0];
        schemaLoaded = mrdFieldsCache.has(`${group}/${kind}`);
      }
      if (!schemaLoaded) continue;
      // Compute map paths for this node so children of map fields are never flagged.
      let mapPaths: Set<string>;
      if (n.id === SCHEMA_NODE_ID) {
        mapPaths = new Set();
      } else {
        let apiv: string | undefined; let knd: string | undefined;
        if (n.type === 'env') {
          const req = envReqsList.find((r: any) => r.requirementName === n.id);
          apiv = req?.apiVersion; knd = req?.kind;
        } else {
          const res = (input?.resources ?? []).find((r: any) => r.id === n.id)
            ?? pendingResources.find(r => r.id === n.id);
          apiv = getResApiVersion(res); knd = getResKind(res);
        }
        const schemaMaps = mrdMapPathsCache.get(`${getGroupVersion(apiv ?? '')[0]}/${knd ?? ''}`) ?? new Set<string>();
        mapPaths = new Set([...K8S_MAP_PATHS, ...schemaMaps]);
      }
      const isUnderMap = (fp: string) => fp.split('.').some(
        (_, i, parts) => i > 0 && mapPaths.has(parts.slice(0, i).join('.'))
      );
      const unknown = new Set<string>();
      for (const row of n.rows) {
        if (row.isParent || row.isGhost || row.isSection || !row.fieldPath) continue;
        if (isUnderMap(row.fieldPath)) continue;
        if (getFieldType(n.id, row.fieldPath) === undefined) unknown.add(row.fieldPath);
      }
      if (unknown.size > 0) map.set(n.id, unknown);
    }
    return map;
  }, [nodesForDisplay, xrdAllFields, input, requirements, pendingResources, mrdFieldsCache, mrdMapPathsCache, getFieldType]);

  /** Maps CEL ref identifier → NodeType for all nodes, for correct source-node pill colouring. */
  const nodeTypeByRef = useMemo(
    () => new Map(nodes.map(n => [nodeIdToRef(n.id), n.type])),
    [nodes]
  );

  const onNodeClick = useCallback((id: string) => {
    if (hasDragged.current) { hasDragged.current = false; return; }
    setSelected(prev => prev === id ? null : id);
  }, []);

  const onTokenLeave = useCallback(() => setTokenHover(null), []);

  /**
   * Two strict one-direction BFS passes from the selected node:
   *   upstream   — follow input  edges only (target→source), never switching direction
   *   downstream — follow output edges only (source→target), never switching direction
   * Nodes found via the upstream pass never contribute their output edges, and vice versa.
   */
  const relatedNodeIds = useMemo((): Set<string> | null => {
    if (!selected) return null;
    const related = new Set<string>([selected]);

    // upstream: follow edges backward (target → source)
    const upQueue = [selected];
    const upVisited = new Set<string>([selected]);
    while (upQueue.length > 0) {
      const id = upQueue.shift()!;
      for (const e of edges) {
        if (e.target === id && !upVisited.has(e.source)) { upVisited.add(e.source); upQueue.push(e.source); related.add(e.source); }
      }
      for (const e of extraEdges) {
        if (e.tgtNodeId === id && !upVisited.has(e.srcNodeId)) { upVisited.add(e.srcNodeId); upQueue.push(e.srcNodeId); related.add(e.srcNodeId); }
      }
    }

    // downstream: follow edges forward (source → target)
    const downQueue = [selected];
    const downVisited = new Set<string>([selected]);
    while (downQueue.length > 0) {
      const id = downQueue.shift()!;
      for (const e of edges) {
        if (e.source === id && !downVisited.has(e.target)) { downVisited.add(e.target); downQueue.push(e.target); related.add(e.target); }
      }
      for (const e of extraEdges) {
        if (e.srcNodeId === id && !downVisited.has(e.tgtNodeId)) { downVisited.add(e.tgtNodeId); downQueue.push(e.tgtNodeId); related.add(e.tgtNodeId); }
      }
    }

    return related;
  }, [selected, edges, extraEdges]);

  const bgWasClean  = useRef(false); // true if bg mousedown had no subsequent mouse movement
  const dragId      = useRef<string | null>(null);
  const dragOrigin  = useRef({ mx: 0, my: 0, nx: 0, ny: 0 });
  const hasDragged  = useRef(false); // true if the current node drag moved the pointer

  const screenToCanvas = useCallback((sx: number, sy: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (sx - r.left - panRef.current.x) / zoomRef.current, y: (sy - r.top - panRef.current.y) / zoomRef.current };
  }, []);

  // ── Add virtual field row to a node ─────────────────────────────────────────

  const addFieldToNode = useCallback((nodeId: string, fieldPath: string): boolean => {
    const path = fieldPath.trim();
    if (!path) return false;
    if (path.startsWith('_')) return false;
    const isMapParent   = allMapPathsMap.get(nodeId)?.has(path) ?? false;
    const isArrayParent = allArrayPathsMap.get(nodeId)?.has(path) ?? false;
    const fieldType = getFieldType(nodeId, path);
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const leafExtra: Partial<TRow> = (isMapParent || isArrayParent)
        ? { isVirtual: true, isParent: true, ...(isArrayParent && { isArrayParent: true }) }
        : fieldType === 'object'
        ? { isVirtual: true, isParent: true }
        : { isVirtual: true, ...(fieldType !== undefined && { ghostType: fieldType }) };
      const newRows = insertRowAtPath(n.rows, path, leafExtra);
      return { ...n, rows: newRows, h: nodeH(newRows) };
    }));
    return true;
  }, [allMapPathsMap, allArrayPathsMap, getFieldType]);

  /** Append the next indexed item row under an array parent (e.g. containers.0, containers.1). */
  const addArrayItemToNode = useCallback((nodeId: string, arrayPath: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const arrayPrefix = arrayPath + '.';
      const nextIdx = n.rows.filter(r => {
        if (!r.fieldPath?.startsWith(arrayPrefix)) return false;
        const seg = r.fieldPath.slice(arrayPrefix.length).split('.')[0];
        return /^\d+$/.test(seg);
      // Count only direct item rows (exact one more segment)
      }).filter(r => r.fieldPath?.slice(arrayPrefix.length).split('.').length === 1).length;
      const itemPath = `${arrayPath}.${nextIdx}`;
      const isObjectArray = [...(allArrayPathsMap.get(nodeId) ?? new Set<string>())].some(
        p => p.startsWith(`${arrayPath}[].`)
      );
      const newRows = insertRowAtPath(n.rows, itemPath,
        isObjectArray ? { isParent: true as const, isVirtual: true } : { isVirtual: true }
      );
      return { ...n, rows: newRows, h: nodeH(newRows) };
    }));
  }, [allArrayPathsMap]);

  /** Add a new virtual entry to a forEach / includeWhen / readyWhen section on a node. */
  const onAddSectionItem = useCallback((nodeId: string, section: string, varName?: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const sec = section as 'forEach' | 'includeWhen' | 'readyWhen';
      const prefix = SECTION_DEFS[sec].prefix;

      // Find the index after the last row that belongs to this section.
      let insertAt = n.rows.length;
      for (let i = n.rows.length - 1; i >= 0; i--) {
        const r = n.rows[i];
        if (r.fieldPath?.startsWith(prefix) || (r.isSection && r.key === sec)) {
          insertAt = i + 1; break;
        }
      }

      let newRow: TRow;
      if (sec === 'forEach') {
        if (!varName) return n;
        const fp = qualifiedPath('forEach', varName);
        if (n.rows.some(r => r.fieldPath === fp)) return n;
        const parts = varName.split('.');
        const key = parts[parts.length - 1];
        const depth = parts.length; // depth=1 for top-level var, depth=2 for sub-field
        const isSubField = parts.length > 1;
        newRow = makeLeafRow(depth, key, fp, undefined, new Set(), isSubField
          ? { isVirtual: true, canImport: false, canExport: true, outPort: { path: fp, short: key } }
          : { isVirtual: true, canImport: true,  canExport: true, outPort: { path: fp, short: key } });

        // For sub-fields, insert after the parent variable row and its existing children.
        if (isSubField) {
          const parentFp = qualifiedPath('forEach', parts.slice(0, -1).join('.'));
          insertAt = n.rows.length;
          for (let i = 0; i < n.rows.length; i++) {
            if (n.rows[i].fieldPath === parentFp || n.rows[i].fieldPath?.startsWith(parentFp + '.')) {
              insertAt = i + 1;
            }
          }
          const newRows = [...n.rows];
          newRows.splice(insertAt, 0, newRow);
          return { ...n, rows: newRows, h: nodeH(newRows) };
        }
      } else {
        // includeWhen / readyWhen — append next indexed entry.
        const prefix = SECTION_DEFS[sec].prefix;
        const existingCount = n.rows.filter(r => r.fieldPath?.startsWith(prefix) && !r.isSection).length;
        const key = String(existingCount);
        const fp = qualifiedPath(sec, key);
        newRow = makeLeafRow(1, key, fp, undefined, new Set(), { isVirtual: true, canImport: true, canExport: false });
      }

      const newRows = [...n.rows];
      const hasHeader = n.rows.some(r => r.isSection && r.key === sec);
      if (!hasHeader) {
        const headerRow: TRow = { depth: 0, key: sec, isParent: false, isSection: true, canImport: false, canExport: false };
        newRows.splice(insertAt, 0, headerRow, newRow);
      } else {
        newRows.splice(insertAt, 0, newRow);
      }
      return { ...n, rows: newRows, h: nodeH(newRows) };
    }));
    setDirtyOps(true);
  }, []);

  // ── Op node handlers ──────────────────────────────────────────────────────────

  const onOpNodeDown = useCallback((e: MouseEvent, id: string) => {
    const node = opNodes.find(n => n.id === id); if (!node) return;
    opDragId.current = id;
    opHasDragged.current = false;
    opDragOrigin.current = { mx: e.clientX, my: e.clientY, nx: node.x, ny: node.y };
  }, [opNodes]);

  const onOpNodeInputPortUp = useCallback((e: MouseEvent, id: string, portName: string) => {
    if (!drawing) return;
    const tgtOpNode = opNodes.find(n => n.id === id);
    const tgtDef = tgtOpNode ? EXPR_NODE_DEFS[tgtOpNode.category] : undefined;
    const portDef = tgtDef?.inputs.find(p => p.name === portName);
    if (typeCompat(drawing.srcType, portDef?.type) === 'incompatible') return;
    setExtraEdges(prev => [
      ...prev.filter(ee => !(ee.tgtNodeId === id && ee.tgtFieldPath === portName)),
      { id: `extra-${Date.now()}`, srcNodeId: drawing.srcNodeId, srcFieldPath: drawing.srcFieldPath,
        tgtNodeId: id, tgtFieldPath: portName },
    ]);
    setDirtyOps(true);
    // Canvas onMouseUp (via bubbling) clears drawing state
  }, [drawing, opNodes]);

  const onOpChange = useCallback((id: string, op: string) => {
    setOpNodes(prev => prev.map(n => n.id === id ? { ...n, op } : n));
    setDirtyOps(true);
  }, []);

  const onOpLiteralChange = useCallback((id: string, portName: string, value: string) => {
    setOpNodes(prev => prev.map(n => n.id === id ? { ...n, literals: { ...n.literals, [portName]: value } } : n));
    setDirtyOps(true);
  }, []);

  const onDeleteOpNode = useCallback((id: string) => {
    setOpNodes(prev => prev.filter(n => n.id !== id));
    setExtraEdges(prev => prev.filter(e => e.srcNodeId !== id && e.tgtNodeId !== id));
    setDirtyOps(true);
  }, []);

  const onOpResizeStart = useCallback((e: MouseEvent, id: string) => {
    const node = opNodes.find(n => n.id === id); if (!node) return;
    opResizeId.current = id;
    opResizeOrigin.current = { my: e.clientY, startH: node.h ?? RAW_TEMPLATE_NODE_H };
  }, [opNodes]);

  const onAddVarField = useCallback((opId: string, fieldPath: string) => {
    const segs = fieldPath.split('.');
    const toAdd = segs.map((_, i) => segs.slice(0, i + 1).join('.'));
    setOpNodes(prev => prev.map(n => {
      if (n.id !== opId) return n;
      const existing = new Set(n.varFields ?? []);
      const merged = [...existing, ...toAdd.filter(p => !existing.has(p))];
      return { ...n, varFields: merged };
    }));
    setDirtyOps(true);
  }, []);

  const onRemoveVarField = useCallback((opId: string, fieldPath: string) => {
    setOpNodes(prev => prev.map(n => n.id === opId
      ? { ...n, varFields: (n.varFields ?? []).filter(f => f !== fieldPath) }
      : n));
    setExtraEdges(prev => prev.filter(e => !(e.srcNodeId === opId && e.srcFieldPath === `var:${fieldPath}`)));
    setDirtyOps(true);
  }, []);

  // ── Variadic port auto-adjustment ────────────────────────────────────────────
  // For variadic op nodes (e.g. string-concat): always keep exactly one trailing
  // empty port. Add a port when all ports are filled; remove the last port when
  // more than one port is empty (and portCount > 2).
  useEffect(() => {
    setOpNodes(prev => {
      let changed = false;
      const next = prev.map(node => {
        const def = EXPR_NODE_DEFS[node.category];
        if (!def?.variadic) return node;
        const count = node.portCount ?? def.inputs.length;
        const portNames = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
        const emptyPorts = portNames.filter(name =>
          !extraEdges.some(e => e.tgtNodeId === node.id && e.tgtFieldPath === name) &&
          (node.literals[name] ?? '').trim() === ''
        );
        if (emptyPorts.length === 0) {
          changed = true;
          return { ...node, portCount: count + 1 };
        }
        if (emptyPorts.length > 1 && count > 2) {
          const lastPort = String.fromCharCode(65 + count - 1);
          if (emptyPorts.includes(lastPort)) {
            changed = true;
            const newLiterals = { ...node.literals };
            delete newLiterals[lastPort];
            return { ...node, portCount: count - 1, literals: newLiterals };
          }
        }
        return node;
      });
      return changed ? next : prev;
    });
  }, [opNodes, extraEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hover target computation ─────────────────────────────────────────────────

  const computeHoverTarget = useCallback((cp: { x: number; y: number }, srcNodeId: string, srcType?: string, srcFieldPath?: string): HoverTarget | null => {
    const srcIsForEach = !!srcFieldPath && sectionOf(srcFieldPath) === 'forEach';
    for (const n of nodes) {
      const isSelf = n.id === srcNodeId;
      // Allow self-loop only when source is a forEach row — the forEach variable feeds template fields on the same node
      if (isSelf && !srcIsForEach) continue;
      if (n.type === 'kro-ref') continue; // external refs are read-only, cannot be drop targets
      if (cp.x < n.x || cp.x > n.x + n.w) continue;
      const displayBottom = n.y + HEADER_H + n.rows.length * ROW_H + 8;
      if (cp.y < n.y || cp.y >= displayBottom) continue;
      const rowIdx = Math.floor((cp.y - n.y - HEADER_H) / ROW_H);
      if (rowIdx >= 0 && rowIdx < n.rows.length && !n.rows[rowIdx].isParent && !n.rows[rowIdx].isSection && n.rows[rowIdx].canImport !== false) {
        const row = n.rows[rowIdx];
        // Self-loops from forEach are only valid targets in the template section
        if (isSelf && sectionOf(row.fieldPath ?? '') !== 'template') continue;
        const tgtType = row.ghostType ?? getFieldType(n.id, row.fieldPath ?? '');
        if (typeCompat(srcType, tgtType) === 'incompatible') return null;
        return { nodeId: n.id, rowIdx, fieldPath: row.fieldPath };
      }
    }
    return null;
  }, [nodes, getFieldType]);

  // ── Mouse handlers ────────────────────────────────────────────────────────────

  const onBgDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    if (drawing) { setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null); return; }
    bgWasClean.current = true;
    hasPanned.current = false;
    panOrigin.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y };
    isPanDragging.current = true;
    setActive(true); e.preventDefault();
  }, [drawing]);

  const onNodeDown = useCallback((e: MouseEvent, id: string) => {
    if (drawing) return;
    dragId.current = id;
    hasDragged.current = false;
    const n = nodes.find(x => x.id === id)!;
    let nx = n.x;
    let ny = n.y;
    // The draft node's visual position is clamped to the container bounds (see DraftNodeCard render).
    // Snap the drag origin to those clamped canvas coords so drag starts from where the card is
    // displayed, eliminating the dead zone caused by the raw canvas position being off-screen.
    if (id === DRAFT_NODE_ID && containerRef.current) {
      const cW = containerRef.current.clientWidth;
      const cH = containerRef.current.clientHeight;
      // Clamp to screen bounds then convert back to canvas coords
      const screenLeft = Math.max(8,  Math.min(n.x * zoomRef.current + panRef.current.x, cW - NW - 8));
      const screenTop  = Math.max(48, Math.min(n.y * zoomRef.current + panRef.current.y, cH - 240));
      nx = (screenLeft - panRef.current.x) / zoomRef.current;
      ny = (screenTop  - panRef.current.y) / zoomRef.current;
      setNodes(prev => prev.map(nd => nd.id === DRAFT_NODE_ID ? { ...nd, x: nx, y: ny } : nd));
    }
    dragOrigin.current = { mx: e.clientX, my: e.clientY, nx, ny };
    setActive(true);
  }, [nodes, drawing]);

  const hasDraggedPort = useRef(false);

  const onPortDown = useCallback((e: MouseEvent, nodeId: string, fieldPath: string) => {
    e.stopPropagation();
    hasDraggedPort.current = false;
    const cp = screenToCanvas(e.clientX, e.clientY);
    const opNode = opNodes.find(n => n.id === nodeId);
    const srcType = opNode
      ? (fieldPath.startsWith('var:') ? 'any' : EXPR_NODE_DEFS[opNode.category]?.outputType)
      : getFieldType(nodeId, fieldPath);
    setDrawing({ srcNodeId: nodeId, srcFieldPath: fieldPath, canvasX: cp.x, canvasY: cp.y, srcType });
    setHoverTarget(null); setActive(true);
  }, [screenToCanvas, opNodes, getFieldType]);

  const onOpNodeOutputPortDown = useCallback((e: MouseEvent, id: string) => {
    onPortDown(e, id, 'output');
  }, [onPortDown]);

  const onVarFieldPortDown = useCallback((e: MouseEvent, opId: string, varFieldPath: string) => {
    onPortDown(e, opId, `${VAR_FIELD_PREFIX}${varFieldPath}`);
  }, [onPortDown]);

  const onPotentialFieldClick = useCallback((nodeId: string, fieldPath: string) => {
    addFieldToNode(nodeId, fieldPath);
  }, [addFieldToNode]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (dragId.current) {
      hasDragged.current = true;
      const dx = (e.clientX - dragOrigin.current.mx) / zoomRef.current;
      const dy = (e.clientY - dragOrigin.current.my) / zoomRef.current;
      setNodes(prev => prev.map(n => n.id === dragId.current
        ? { ...n, x: dragOrigin.current.nx + dx, y: dragOrigin.current.ny + dy } : n));
    }
    if (opDragId.current) {
      opHasDragged.current = true;
      const dx = (e.clientX - opDragOrigin.current.mx) / zoomRef.current;
      const dy = (e.clientY - opDragOrigin.current.my) / zoomRef.current;
      setOpNodes(prev => prev.map(n => n.id === opDragId.current
        ? { ...n, x: opDragOrigin.current.nx + dx, y: opDragOrigin.current.ny + dy }
        : n));
    }
    if (opResizeId.current) {
      const dy = (e.clientY - opResizeOrigin.current.my) / zoomRef.current;
      const newH = Math.max(OP_NODE_HDR_H + 32, opResizeOrigin.current.startH + dy);
      setOpNodes(prev => prev.map(n => n.id === opResizeId.current ? { ...n, h: newH } : n));
    }
    if (isPanDragging.current && !dragId.current && !opDragId.current && !opResizeId.current && !drawing) {
      const dx = e.clientX - panOrigin.current.mx;
      const dy = e.clientY - panOrigin.current.my;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasPanned.current = true;
      panRef.current = { x: panOrigin.current.px + dx, y: panOrigin.current.py + dy };
      applyTransform();
    }
    if (drawing) {
      hasDraggedPort.current = true;
      const cp = screenToCanvas(e.clientX, e.clientY);
      setDrawing(d => d ? { ...d, canvasX: cp.x, canvasY: cp.y } : null);
      setHoverTarget(computeHoverTarget(cp, drawing.srcNodeId, drawing.srcType, drawing.srcFieldPath));
      // Track which node the cursor is over, independent of valid drop row
      const srcIsForEach = !!drawing.srcFieldPath && sectionOf(drawing.srcFieldPath) === 'forEach';
      const overNode = nodes.find(n => {
        if (n.id === drawing.srcNodeId && !srcIsForEach) return false;
        if (cp.x < n.x || cp.x > n.x + n.w) return false;
        // Only env nodes have a bottom "Add field" row; kro-resource nodes use inline map-parent adding.
        const addFieldH = n.type === 'env' ? ROW_H : 0;
        const displayBottom = n.y + HEADER_H + n.rows.length * ROW_H + 8 + addFieldH;
        return cp.y >= n.y && cp.y < displayBottom;
      });
      setDrawingHoverNodeId(overNode?.id ?? null);
    }
  }, [drawing, screenToCanvas, computeHoverTarget, nodes, applyTransform]);

  const onInPortClick = useCallback((nodeId: string, fieldPath: string) => {
    for (const ge of edges) {
      if (ge.target === nodeId && getEdgeTargetFieldPath(ge) === fieldPath) removeExistingEdge(ge);
    }
    setExtraEdges(prev => prev.filter(e => !(e.tgtNodeId === nodeId && e.tgtFieldPath === fieldPath)));
    // If the row has a saved celExpr or segments template (e.g. an op-node connection), clear it
    // so the field becomes editable instead of showing "invalid CEL".
    const row = nodeMap.get(nodeId)?.rows.find(r => r.fieldPath === fieldPath);
    if (row && (row.celExpr || row.segments)) {
      setFieldEdits(prev => [
        ...prev.filter(e => !(e.nodeId === nodeId && e.fieldPath === fieldPath)),
        { nodeId, fieldPath, template: '' },
      ]);
    }
  }, [edges, getEdgeTargetFieldPath, removeExistingEdge, nodeMap]);

  const onOpInputPortClick = useCallback((id: string, portName: string) => {
    setExtraEdges(prev => prev.filter(e => !(e.tgtNodeId === id && e.tgtFieldPath === portName)));
    setDirtyOps(true);
  }, []);

  const onMouseUp = useCallback(() => {
    if (bgWasClean.current && !hasPanned.current) { setSelected(null); }
    bgWasClean.current = false;
    isPanDragging.current = false;
    const upOpDragId = opDragId.current;
    dragId.current = null; opDragId.current = null; opResizeId.current = null; setActive(false);
    if (upOpDragId && !opHasDragged.current) {
      setSelected(prev => prev === upOpDragId ? null : upOpDragId);
    }
    opHasDragged.current = false;
    if (drawing) {
      if (hoverTarget?.fieldPath) {
        // Block connecting tainted op nodes directly to resource fields
        const srcOpNode = opNodes.find(n => n.id === drawing.srcNodeId);
        if (srcOpNode?.taints?.length) {
          setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null);
          return;
        }
        const tgtNode = nodeMap.get(hoverTarget.nodeId);
        if (tgtNode && !tgtNode.rows.some(r => r.fieldPath === hoverTarget.fieldPath)) {
          // Dropped on a ghost (potential) field row — materialise it first
          addFieldToNode(hoverTarget.nodeId, hoverTarget.fieldPath);
        }
        // Input connectors accept exactly one connection — replace any existing edge to this field.
        setExtraEdges(prev => [
          ...prev.filter(ee => !(ee.tgtNodeId === hoverTarget.nodeId && ee.tgtFieldPath === hoverTarget.fieldPath)),
          { id: `extra-${Date.now()}`, srcNodeId: drawing.srcNodeId, srcFieldPath: drawing.srcFieldPath,
            tgtNodeId: hoverTarget.nodeId, tgtFieldPath: hoverTarget.fieldPath },
        ]);
        // Mark any committed GEdge to the same field as deleted so it renders faded until save.
        for (const ge of edges) {
          if (ge.target === hoverTarget.nodeId && getEdgeTargetFieldPath(ge) === hoverTarget.fieldPath) {
            removeExistingEdge(ge);
          }
        }
        setDirtyOps(true);
      } else if (!hasDraggedPort.current) {
        // Click without drag on output port — delete all edges from this port.
        for (const ge of edges) {
          if (ge.source === drawing.srcNodeId && ge.srcPortPath === drawing.srcFieldPath) removeExistingEdge(ge);
        }
        setExtraEdges(prev => prev.filter(e => !(e.srcNodeId === drawing.srcNodeId && e.srcFieldPath === drawing.srcFieldPath)));
        if (opNodes.some(n => n.id === drawing.srcNodeId)) setDirtyOps(true);
      }
      setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null);
    }
  }, [drawing, hoverTarget, nodeMap, addFieldToNode, edges, getEdgeTargetFieldPath, removeExistingEdge, opNodes]);


  /** Returns the accent color for a given graph-node id (source of an edge). */
  const nodeColor = useCallback((nodeId: string): string => {
    const node = displayNodeMap.get(nodeId);
    if (!node) return userC;
    const cfg = NODE_CFG[node.type];
    return cfg ? (dark ? cfg.accentDark : cfg.accent) : userC;
  }, [displayNodeMap, dark, userC]);

  /** One marker per node type + 'user' (op nodes). Used for arrowheads. */
  const markerDefs = useMemo(() => ([
    ...(['schema', 'env', 'kro-resource', 'kro-ref'] as const).map(t => ({
      key: t, color: dark ? NODE_CFG[t].accentDark : NODE_CFG[t].accent,
    })),
    { key: 'user' as const, color: userC },
  ]), [dark, userC]);

  const eid = useRef(`cne-${Math.random().toString(36).slice(2, 7)}`).current;

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Non-passive wheel: two-finger scroll = pan, pinch (ctrlKey) = zoom.
  // Browsers set ctrlKey=true for trackpad pinch even without the physical key.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Pinch-to-zoom or ctrl+wheel — zoom centered on cursor
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        // Trackpad pinch fires many small deltaY; mouse wheel fires large discrete ones.
        // Math.exp gives smooth continuous zoom for both.
        const factor = Math.exp(-e.deltaY / 200);
        const z = zoomRef.current;
        const newZoom = Math.min(3, Math.max(0.15, z * factor));
        const p = panRef.current;
        panRef.current = {
          x: mx - (mx - p.x) * (newZoom / z),
          y: my - (my - p.y) * (newZoom / z),
        };
        zoomRef.current = newZoom;
        applyTransform();
      } else {
        // Two-finger scroll = pan
        panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
        applyTransform();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pinch-to-zoom (touch)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        lastDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (lastDist > 0) {
        const r = el.getBoundingClientRect();
        const mx = (t0.clientX + t1.clientX) / 2 - r.left;
        const my = (t0.clientY + t1.clientY) / 2 - r.top;
        const factor = dist / lastDist;
        const z = zoomRef.current;
        const newZoom = Math.min(3, Math.max(0.15, z * factor));
        const p = panRef.current;
        panRef.current = {
          x: mx - (mx - p.x) * (newZoom / z),
          y: my - (my - p.y) * (newZoom / z),
        };
        zoomRef.current = newZoom;
        applyTransform();
      }
      lastDist = dist;
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete) return;
    const id = confirmDelete;
    setNodes(prev => prev.filter(n => n.id !== id));
    // If it was only just added in this session, remove from pending adds; otherwise track for save-time removal.
    if (pendingResources.some(r => r.id === id)) {
      setPendingResources(prev => prev.filter(r => r.id !== id));
    } else {
      setPendingRemovals(prev => [...prev, id]);
    }
    setFieldEdits(prev => prev.filter(e => e.nodeId !== id));
    setExtraEdges(prev => prev.filter(e => e.srcNodeId !== id && e.tgtNodeId !== id));
    setSelected(s => s === id ? null : s);
    setConfirmDelete(null);
  }, [confirmDelete, pendingResources]);

  /** Toggle the optional-chaining `?` marker on an inPort field's CEL template. */
  const toggleInPortOptional = useCallback((nodeId: string, fieldPath: string) => {
    const displayNode = nodesForDisplay.find(n => n.id === nodeId);
    if (!displayNode) return;
    const row = displayNode.rows.find(r => r.fieldPath === fieldPath);
    if (!row?.inPort) return;
    const { ref, srcPath } = row.inPort;
    let newSrcPath: string;
    if (srcPath.includes('?')) {
      newSrcPath = srcPath.replace(/\?/g, '');
    } else {
      const lastDot = srcPath.lastIndexOf('.');
      newSrcPath = lastDot === -1 ? `?${srcPath}` : `${srcPath.slice(0, lastDot + 1)}?${srcPath.slice(lastDot + 1)}`;
    }
    const newTemplate = `\${${ref}.${newSrcPath}}`;
    setFieldEdits(prev => [
      ...prev.filter(e => !(e.nodeId === nodeId && e.fieldPath === fieldPath)),
      { nodeId, fieldPath, template: newTemplate },
    ]);
  }, [nodesForDisplay]);

  const onValueEdit = useCallback((nodeId: string, fieldPath: string, value: string) => {
    setFieldEdits(prev => [
      ...prev.filter(e => !(e.nodeId === nodeId && e.fieldPath === fieldPath)),
      { nodeId, fieldPath, template: value },
    ]);
  }, []);

  const toggleOpPortOptional = useCallback((opNodeId: string, portName: string) => {
    const edge = extraEdges.find(e => e.tgtNodeId === opNodeId && e.tgtFieldPath === portName);
    if (!edge) return;
    const srcPath = edge.srcFieldPath;
    let newSrcPath: string;
    if (srcPath.includes('?')) {
      newSrcPath = srcPath.replace(/\?/g, '');
    } else {
      const lastDot = srcPath.lastIndexOf('.');
      newSrcPath = lastDot === -1 ? `?${srcPath}` : `${srcPath.slice(0, lastDot + 1)}?${srcPath.slice(lastDot + 1)}`;
    }
    setExtraEdges(prev => prev.map(e =>
      e.id === edge.id ? { ...e, srcFieldPath: newSrcPath } : e
    ));
  }, [extraEdges]);

  /** Remove a field row from a node and mark it for deletion at save time. */
  const onDeleteRow = useCallback((nodeId: string, fieldPath: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const newRows = removeRowAtPath(n.rows, fieldPath);
      return { ...n, rows: newRows, h: nodeH(newRows) };
    }));
    // Mark for deletion at save time (template: '' means delete in applyFieldEditsToInput).
    // Also clean up any prior edits for this path and all descendant paths.
    const isDescendantOrSelf = (p: string) => p === fieldPath || p.startsWith(fieldPath + '.');
    const reindex = (p: string) => reindexPathAfterDelete(fieldPath, p);
    setFieldEdits(prev => [
      ...prev
        .filter(e => !(e.nodeId === nodeId && isDescendantOrSelf(e.fieldPath)))
        .map(e => e.nodeId === nodeId ? { ...e, fieldPath: reindex(e.fieldPath) } : e),
      { nodeId, fieldPath, template: '' },
    ]);
    // Remove extra edges that referenced this field or any of its descendants,
    // and renumber surviving sibling paths.
    setExtraEdges(prev => prev
      .filter(e =>
        !(e.tgtNodeId === nodeId && isDescendantOrSelf(e.tgtFieldPath)) &&
        !(e.srcNodeId === nodeId && isDescendantOrSelf(e.srcFieldPath))
      )
      .map(e => ({
        ...e,
        tgtFieldPath: e.tgtNodeId === nodeId ? reindex(e.tgtFieldPath) : e.tgtFieldPath,
        srcFieldPath: e.srcNodeId === nodeId ? reindex(e.srcFieldPath) : e.srcFieldPath,
      }))
    );
  }, []);

  const handleAddResource = useCallback(() => {
    if (!addForm) return;
    const { id, apiVersion, kind, mode, refLookup, refName, refLabels } = addForm;
    if (!id.trim() || !apiVersion.trim() || !kind.trim()) return;
    if (nodes.filter(n => n.id !== DRAFT_NODE_ID).some(n => n.id === id.trim())) return; // duplicate id

    const trimId = id.trim();
    const trimAv = apiVersion.trim();
    const trimKind = kind.trim();

    let nodeType: NodeType;
    let displayTemplate: Record<string, unknown>;
    let pending: PendingResource;

    if (mode === 'externalRef') {
      const matchLabels = Object.fromEntries(
        refLabels.flatMap(l => { const k = l.key.trim(); return k ? [[k, l.value.trim()]] : []; })
      );
      const metadata: Record<string, unknown> =
        refLookup === 'name' && refName.trim()
          ? { name: refName.trim() }
          : { selector: { matchLabels } };
      nodeType = 'kro-ref';
      displayTemplate = { apiVersion: trimAv, kind: trimKind, metadata };
      pending = {
        type: 'externalRef', id: trimId, apiVersion: trimAv, kind: trimKind,
        ...(refLookup === 'name' && refName.trim() ? { name: refName.trim() } : { matchLabels }),
      };
    } else {
      nodeType = 'kro-resource';
      displayTemplate = { apiVersion: trimAv, kind: trimKind, metadata: {} };
      pending = { type: 'template', id: trimId, apiVersion: trimAv, kind: trimKind };
    }

    const rows = buildTemplateRows(displayTemplate, new Set(), new Set(), new Set());
    // Replace the draft node in-place (preserving its canvas position)
    setNodes(prev => prev.map(n =>
      n.id === DRAFT_NODE_ID
        ? { ...n, id: trimId, type: nodeType, label: trimId, rows, h: nodeH(rows) }
        : n
    ));
    setPendingResources(prev => [...prev, pending]);
    setAddForm(null);
  }, [addForm, nodes]);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cW = el.clientWidth;
    const cH = el.clientHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      if (n.id === DRAFT_NODE_ID) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    for (const n of opNodes) {
      const def = EXPR_NODE_DEFS[n.category];
      const portCount = (n.portCount ?? def?.inputs.length ?? 2) + opNodeVarFieldExtraRows(n.varFields ?? []);
      const h = n.h ?? opNodeH(portCount);
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + OP_NODE_W); maxY = Math.max(maxY, n.y + h);
    }
    if (!isFinite(minX)) return;
    const PAD = 40;
    const newZoom = Math.min(3, Math.max(0.15, Math.min(
      cW / (maxX - minX + PAD * 2),
      cH / (maxY - minY + PAD * 2),
    )));
    panRef.current = {
      x: cW / 2 - ((minX + maxX) / 2) * newZoom,
      y: cH / 2 - ((minY + maxY) / 2) * newZoom,
    };
    zoomRef.current = newZoom;
    applyTransform();
  }, [nodes, opNodes, applyTransform]);

  const hasFitOnMount = useRef(false);
  useEffect(() => {
    if (hasFitOnMount.current) return;
    hasFitOnMount.current = true;
    fitView();
  }, [fitView]);

  if (!nodes.length) return null;

  return (
    <Box ref={containerRef} sx={{
      position: 'relative', width: '100%', height: isFullscreen ? '100vh' : height,
      bgcolor: dark ? '#111' : '#f3f3f7', borderRadius: 1, overflow: 'hidden',
      cursor: drawing ? 'crosshair' : active ? 'grabbing' : 'grab',
      backgroundImage: `radial-gradient(${dark ? '#2a2a2a' : '#c5c5ce'} 1px, transparent 1px)`,
      backgroundSize: '24px 24px', userSelect: 'none',
    }}
    onMouseDown={onBgDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
    onMouseLeave={() => { onMouseUp(); setHoverTarget(null); setDrawingHoverNodeId(null); }}
    >
      {/* Toolbar */}
      <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 0.5 }}>
        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <IconButton size="small" onClick={toggleFullscreen}
            sx={{ bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
            <Icon icon={isFullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'} width={17} height={17} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit nodes to view">
          <IconButton size="small" onClick={fitView}
            sx={{ bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
            <Icon icon="mdi:fit-to-screen-outline" width={17} height={17} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Add resource">
          <IconButton size="small"
            onClick={() => {
              if (nodes.some(n => n.id === DRAFT_NODE_ID)) return;
              const cW = containerRef.current?.clientWidth ?? 800;
              const cH = containerRef.current?.clientHeight ?? 480;
              const cx = (cW / 2 - panRef.current.x) / zoomRef.current - NW / 2;
              const cy = (cH / 2 - panRef.current.y) / zoomRef.current - 110;
              setNodes(prev => [...prev, { id: DRAFT_NODE_ID, type: 'draft', label: '', rows: [], x: cx, y: cy, w: NW, h: 220 }]);
              setAddForm({ id: '', apiVersion: '', kind: '', mode: 'template', refLookup: 'name', refName: '', refLabels: [] });
            }}
            sx={{ bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
            <Icon icon="mdi:plus" width={17} height={17} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Add op node">
          <IconButton size="small"
            onClick={() => setAddOpForm(f => f ? null : Object.keys(EXPR_NODE_DEFS)[0])}
            sx={{ bgcolor: addOpForm ? alpha(userC, 0.12) : 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
            <Icon icon="mdi:function-variant" width={17} height={17} style={{ color: addOpForm ? userC : undefined }} />
          </IconButton>
        </Tooltip>
        {addOpForm !== null && (
          <OpNodePalette
            userC={userC}
            onAdd={def => {
              const cW = containerRef.current?.clientWidth ?? 800;
              const cH = containerRef.current?.clientHeight ?? 480;
              const nx = (cW * 0.6 - panRef.current.x) / zoomRef.current;
              const ny = (cH * 0.5 - panRef.current.y) / zoomRef.current;
              setOpNodes(prev => [...prev, {
                id: `op-${Date.now()}`,
                category: def.category,
                op: def.defaultOp,
                x: nx, y: ny,
                literals: {},
              }]);
              setDirtyOps(true);
              setAddOpForm(null);
            }}
            onClose={() => setAddOpForm(null)}
          />
        )}
        {isDirty && (
          <Tooltip title={
            saveState === 'saving' ? 'Saving…'
            : saveState === 'saved'  ? 'Saved!'
            : saveState === 'error'  ? 'Save failed — check console'
            : 'Save connections to cluster'
          }>
            <span>
              <IconButton size="small" onClick={handleSave} disabled={saveState === 'saving'}
                sx={{
                  bgcolor: saveState === 'saved'  ? alpha('#2e7d32', 0.15)
                         : saveState === 'error'  ? alpha('#c62828', 0.15)
                         : 'background.paper',
                  boxShadow: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}>
                <Icon icon={
                  saveState === 'saving' ? 'mdi:cloud-upload-outline'
                  : saveState === 'saved'  ? 'mdi:check-circle-outline'
                  : saveState === 'error'  ? 'mdi:alert-circle-outline'
                  : 'mdi:content-save-outline'
                } width={17} height={17}
                  style={{ color:
                    saveState === 'saved'  ? '#2e7d32'
                    : saveState === 'error' ? '#c62828'
                    : undefined
                  }}
                />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {isDirty && (
          <Tooltip title="Discard all changes">
            <IconButton size="small" onClick={() => { setExtraEdges(initExtraEdges); setOpNodes(initOpNodes); setDirtyOps(false); setSavedOpNodeIds(new Set(initOpNodes.map(n => n.id))); setSavedEdgeIds(new Set(initExtraEdges.map(e => e.id))); setFieldEdits([]); setPendingResources([]); setPendingRemovals([]); setAddForm(null); setConfirmDelete(null); setNodes(initNodes); }}
              sx={{ bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
              <Icon icon="mdi:undo" width={17} height={17} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Delete confirmation */}
      {confirmDelete && (
        <Paper elevation={4} sx={{
          position: 'absolute', top: 48, right: 8, zIndex: 20,
          p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, width: 260,
        }}
          onMouseDown={e => e.stopPropagation()}
        >
          <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.8 }}>Remove resource?</Typography>
          <Typography variant="caption" sx={{ opacity: 0.65, wordBreak: 'break-all' }}>
            "{confirmDelete}" will be removed from the composition when you save.
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button size="small" variant="contained" color="error" disableElevation onClick={handleConfirmDelete}>
              Remove
            </Button>
          </Box>
        </Paper>
      )}

      {/* Draft node — rendered outside the canvas transform so text inputs don't trigger scroll-into-view.
          Screen coords are clamped to the container bounds so the input is always visible (prevents the
          browser from scrolling a parent element to reveal an off-screen input, which would shift the
          toolbar and other overlay elements). */}
      {(() => {
        if (!addForm) return null;
        const draftNode = nodeMap.get(DRAFT_NODE_ID);
        if (!draftNode) return null;
        const existingIds = new Set(nodes.filter(n => n.id !== DRAFT_NODE_ID).map(n => n.id));
        const cW = containerRef.current?.clientWidth  ?? 800;
        const cH = containerRef.current?.clientHeight ?? 480;
        const screenLeft = Math.max(8,  Math.min(draftNode.x * zoomRef.current + panRef.current.x, cW - NW - 8));
        const screenTop  = Math.max(48, Math.min(draftNode.y * zoomRef.current + panRef.current.y, cH - 240));
        return (
          <DraftNodeCard
            node={draftNode}
            screenLeft={screenLeft}
            screenTop={screenTop}
            dark={dark}
            addForm={addForm}
            kindOptions={kindOptions}
            existingIds={existingIds}
            onFormChange={setAddForm}
            onConfirm={handleAddResource}
            onCancel={() => { setNodes(prev => prev.filter(n => n.id !== DRAFT_NODE_ID)); setAddForm(null); }}
            onMouseDown={onNodeDown}
          />
        );
      })()}

      {/* Legend */}
      <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, display: 'flex', gap: 1, alignItems: 'center', bgcolor: 'background.paper', borderRadius: 1, px: 1.25, py: 0.6, boxShadow: 1 }}>
        {(Object.entries(NODE_CFG) as [NodeType, typeof NODE_CFG[NodeType]][]).filter(([type]) => type !== 'draft').map(([type, cfg]) => (
          <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
            <Icon icon={cfg.icon} width={12} style={{ color: dark ? cfg.accentDark : cfg.accent }} />
            <Typography variant="caption" sx={{ fontSize: '0.64rem', opacity: 0.65 }}>{cfg.label}</Typography>
          </Box>
        ))}
        {drawing && <Typography variant="caption" sx={{ fontSize: '0.62rem', color: userC, ml: 0.5 }}>drop on the left side of another node to connect</Typography>}
      </Box>

      {/* Canvas */}
      <div ref={canvasDivRef} style={{ position: 'absolute', width: CANVAS_SIZE, height: CANVAS_SIZE, transformOrigin: '0 0', transform: 'translate(0px,0px) scale(1)', willChange: 'transform' }}>
        <svg style={{ position: 'absolute', top: 0, left: 0, width: CANVAS_SIZE, height: CANVAS_SIZE, pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
          <defs>
            {markerDefs.map(({ key, color }) => (
              <marker key={key} id={`${eid}-${key}`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
                <polygon points="0 0,8 3,0 6" fill={color} opacity={0.9} />
              </marker>
            ))}
          </defs>

          {edges.map(e => {
            const src = displayNodeMap.get(e.source); const tgt = displayNodeMap.get(e.target);
            if (!src || !tgt) return null;
            const isHov = hoveredEdgeId === e.id;
            const isLit = !!tokenHover
              && e.source === tokenHover.srcNodeId
              && e.srcPortPath === tokenHover.srcPath
              && e.target === tokenHover.tgtNodeId;
            const edgeTargetFp = getEdgeTargetFieldPath(e);
            const isDeleted = !!edgeTargetFp &&
              fieldEdits.some(fe => fe.nodeId === e.target && fe.fieldPath === edgeTargetFp && fe.template === '');
            const srcExpanded = !drawing && (src.id === selected || src.id === drawingHoverNodeId);
            const tgtExpanded = !drawing && (tgt.id === selected || tgt.id === drawingHoverNodeId);
            const srcOff = srcExpanded ? sectionAddBarOffset(src) : 0;
            const tgtOff = tgtExpanded ? sectionAddBarOffset(tgt) : 0;
            const sy = srcPortY(src, e.srcPortPath, srcOff);
            const ty = tgtPortY(tgt, e.tgtPortKey, tgtOff);
            const isSelfLoop = e.source === e.target;
            const d = isSelfLoop
              ? makeBezier(src.x + src.w, sy, src.x, ty)
              : bezierPath(src, tgt, e, srcOff, tgtOff);
            const mx = isSelfLoop ? src.x + src.w + 24 : (src.x + src.w + tgt.x) / 2;
            const my = (sy + ty) / 2;
            const col = nodeColor(e.source);
            return (
              <g key={e.id}>
                <path d={d} fill="none" stroke={col}
                  strokeWidth={isLit ? 3 : 1.75}
                  strokeOpacity={isDeleted ? 0.2 : isLit ? 1 : tokenHover ? 0.25 : relatedNodeIds && (!relatedNodeIds.has(e.source) || !relatedNodeIds.has(e.target)) ? 0.08 : isHov ? 0.9 : 0.75}
                  strokeDasharray={isDeleted ? '4 4' : undefined}
                  markerEnd={isDeleted ? undefined : `url(#${eid}-${src.type})`}
                  style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }} />
                {/* Wide transparent hit path */}
                <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdgeId(e.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)} />
                {isHov && isDeleted && (
                  <g transform={`translate(${mx},${my})`}
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredEdgeId(e.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                    onClick={ev => {
                      ev.stopPropagation();
                      if (edgeTargetFp) setFieldEdits(prev => prev.filter(fe => !(fe.nodeId === e.target && fe.fieldPath === edgeTargetFp)));
                      setHoveredEdgeId(null);
                    }}>
                    <circle r={8} fill={dark ? '#333' : '#fff'} stroke={col} strokeWidth={1.5} />
                    <line x1={-3} y1={0} x2={3} y2={0} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}

          {extraEdges.map(e => {
            const srcOp = opNodes.find(n => n.id === e.srcNodeId);
            const tgtOp = opNodes.find(n => n.id === e.tgtNodeId);
            const src = srcOp ? null : displayNodeMap.get(e.srcNodeId);
            const tgt = tgtOp ? null : displayNodeMap.get(e.tgtNodeId);
            if (!srcOp && !src) return null;
            if (!tgtOp && !tgt) return null;
            const isHov = hoveredEdgeId === e.id;
            const isLit = !!tokenHover
              && e.srcNodeId === tokenHover.srcNodeId
              && e.srcFieldPath === tokenHover.srcPath
              && e.tgtNodeId === tokenHover.tgtNodeId;
            let sx2: number;
            let sy2: number;
            if (srcOp) {
              sx2 = srcOp.x + OP_NODE_W;
              if (e.srcFieldPath.startsWith(VAR_FIELD_PREFIX)) {
                const varFieldPath = e.srcFieldPath.slice(VAR_FIELD_PREFIX.length);
                const srcDef = EXPR_NODE_DEFS[srcOp.category];
                const vpi = srcDef?.inputs.findIndex(p => p.name === 'var') ?? 0;
                const srcVarFields = srcOp.varFields ?? [];
                const vfi = Math.max(0, srcVarFields.indexOf(varFieldPath));
                sy2 = srcOp.y + OP_NODE_HDR_H + varFieldLeafRow(srcVarFields, vpi, vfi) * OP_NODE_PORT_H + OP_NODE_PORT_H / 2;
              } else {
                const srcDef = EXPR_NODE_DEFS[srcOp.category];
                const portCount = srcDef?.variadic ? (srcOp.portCount ?? srcDef.inputs.length) : (srcDef?.inputs.length ?? 1);
                sy2 = opNodeOutputPortY(srcOp, portCount);
              }
            } else {
              sx2 = src!.x + src!.w;
              const srcExp = !drawing && (src!.id === selected || src!.id === drawingHoverNodeId);
              sy2 = extraPortY(src!, e.srcFieldPath, srcExp ? sectionAddBarOffset(src!) : 0);
            }
            let tx2: number;
            let ty2: number;
            if (tgtOp) {
              const def = EXPR_NODE_DEFS[tgtOp.category];
              // For variadic nodes, port index is letter ordinal (A=0, B=1, C=2, ...)
              const portIdx = def?.variadic
                ? (e.tgtFieldPath.charCodeAt(0) - 65)
                : (def?.inputs.findIndex(p => p.name === e.tgtFieldPath) ?? 0);
              tx2 = tgtOp.x;
              const tgtVarPortIdx = def?.hasPredicate ? def.inputs.findIndex(p => p.name === 'var') : -1;
              const tgtOffset = tgtVarPortIdx >= 0 && portIdx > tgtVarPortIdx
                ? opNodeVarFieldExtraRows(tgtOp.varFields ?? []) * OP_NODE_PORT_H
                : 0;
              ty2 = opNodeInputPortY(tgtOp, portIdx) + tgtOffset;
            } else {
              tx2 = tgt!.x;
              const tgtExp = !drawing && (tgt!.id === selected || tgt!.id === drawingHoverNodeId);
              ty2 = extraPortY(tgt!, e.tgtFieldPath, tgtExp ? sectionAddBarOffset(tgt!) : 0);
            }
            const col2 = srcOp ? userC : nodeColor(e.srcNodeId);
            const markerKey = srcOp ? 'user' : (src?.type ?? 'kro-resource');
            const d = makeBezier(sx2, sy2, tx2, ty2);
            return (
              <g key={e.id}>
                <path d={d} fill="none" stroke={col2}
                  strokeWidth={isLit ? 3 : 1.75}
                  strokeOpacity={isLit ? 1 : tokenHover ? 0.25 : relatedNodeIds && (!relatedNodeIds.has(e.srcNodeId) || !relatedNodeIds.has(e.tgtNodeId)) ? 0.08 : isHov ? 0.9 : 0.75}
                  strokeDasharray={savedEdgeIds.has(e.id) ? undefined : '6 3'} markerEnd={`url(#${eid}-${markerKey})`}
                  style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }} />
                {/* Wide transparent hit path */}
                <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdgeId(e.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)} />
              </g>
            );
          })}

          {drawing && (() => {
            const opSrc = opNodes.find(n => n.id === drawing.srcNodeId);
            if (opSrc) {
              const sx = opSrc.x + OP_NODE_W;
              let sy: number;
              if (drawing.srcFieldPath.startsWith(VAR_FIELD_PREFIX)) {
                const varFieldPath = drawing.srcFieldPath.slice(VAR_FIELD_PREFIX.length);
                const opSrcDef = EXPR_NODE_DEFS[opSrc.category];
                const vpi = opSrcDef?.inputs.findIndex(p => p.name === 'var') ?? 0;
                const drawVarFields = opSrc.varFields ?? [];
                const vfi = Math.max(0, drawVarFields.indexOf(varFieldPath));
                sy = opSrc.y + OP_NODE_HDR_H + varFieldLeafRow(drawVarFields, vpi, vfi) * OP_NODE_PORT_H + OP_NODE_PORT_H / 2;
              } else {
                const opSrcDef = EXPR_NODE_DEFS[opSrc.category];
                const portCount = opSrcDef?.variadic ? (opSrc.portCount ?? opSrcDef.inputs.length) : (opSrcDef?.inputs.length ?? 1);
                sy = opNodeOutputPortY(opSrc, portCount);
              }
              return <path d={makeBezier(sx, sy, drawing.canvasX, drawing.canvasY)}
                fill="none" stroke={userC} strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="5 4" />;
            }
            const src = displayNodeMap.get(drawing.srcNodeId); if (!src) return null;
            const drawCol = nodeColor(drawing.srcNodeId);
            return <path d={makeBezier(src.x + src.w, extraPortY(src, drawing.srcFieldPath), drawing.canvasX, drawing.canvasY)}
              fill="none" stroke={drawCol} strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="5 4" />;
          })()}
        </svg>

        {nodesForDisplay.map(n => (
          <NodeCard key={n.id} node={n} selected={selected === n.id} dark={dark}
            isDrawing={!!drawing}
            hoverRowIdx={hoverTarget?.nodeId === n.id ? hoverTarget.rowIdx : undefined}
            onMouseDown={onNodeDown}
            onClick={onNodeClick}
            onPortDown={onPortDown}
            potentialFields={allSuggestionsMap.get(n.id) ?? []}
            allSchemaFields={allSchemaFieldsMap.get(n.id)}
            isExpanded={selected === n.id || drawingHoverNodeId === n.id}
            onPotentialFieldClick={onPotentialFieldClick}
            onTokenHover={setTokenHover}
            onTokenLeave={onTokenLeave}
            editedPaths={editedPaths}
            onDelete={setConfirmDelete}
            onDeleteRow={onDeleteRow}
            mapParentPaths={allMapPathsMap.get(n.id)}
            arrayParentPaths={allArrayPathsMap.get(n.id)}
            preserveUnknownParentPaths={allPreserveUnknownPathsMap.get(n.id)}
            onAddArrayItem={addArrayItemToNode}
            onAddSectionItem={onAddSectionItem}
            nodeTypeByRef={nodeTypeByRef}
            unknownFieldPaths={allUnknownPathsMap.get(n.id)}
            noSchemaWarning={noSchemaNodeIds.has(n.id)}
            onToggleInPortOptional={toggleInPortOptional}
            onPortClick={onInPortClick}
            activeInPaths={activeInPathsByNode.get(n.id)}
            activeOutPaths={activeOutPathsByNode.get(n.id)}
            opConnectedFields={opConnectedFieldsByNode.get(n.id)}
            onValueEdit={onValueEdit}
            dimmed={relatedNodeIds !== null && !relatedNodeIds.has(n.id)}
          />
        ))}

        {/* ── Op nodes (first-class persistent canvas nodes) ──────────── */}
        {opNodes.map(opNode => (
          <ExprOpNodeCard
            key={opNode.id}
            node={opNode}
            dark={dark}
            userC={userC}
            isDrawing={!!drawing}
            selected={selected === opNode.id}
            connectedPortInfo={connectedPortInfoByOpId.get(opNode.id) ?? new Map()}
            onNodeDown={onOpNodeDown}
            onOutputPortDown={onOpNodeOutputPortDown}
            onInputPortUp={onOpNodeInputPortUp}
            onInputPortClick={onOpInputPortClick}
            hasOutputConnection={extraEdges.some(e => e.srcNodeId === opNode.id && e.srcFieldPath === 'output')}
            onOpChange={onOpChange}
            onLiteralChange={onOpLiteralChange}
            onResizeStart={onOpResizeStart}
            dirty={!savedOpNodeIds.has(opNode.id)}
            onDelete={onDeleteOpNode}
            onTogglePortOptional={toggleOpPortOptional}
            onTokenHover={setTokenHover}
            onTokenLeave={onTokenLeave}
            onAddVarField={onAddVarField}
            onRemoveVarField={onRemoveVarField}
            onVarFieldPortDown={onVarFieldPortDown}
            hasVarFieldConnection={(vf) => extraEdges.some(e => e.srcNodeId === opNode.id && e.srcFieldPath === `${VAR_FIELD_PREFIX}${vf}`)}
            opNodesById={opNodesById}
            dimmed={relatedNodeIds !== null && !relatedNodeIds.has(opNode.id)}
          />
        ))}
      </div>

    </Box>
  );
}
