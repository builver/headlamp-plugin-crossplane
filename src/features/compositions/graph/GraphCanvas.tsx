import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Fragment, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGroupVersion } from '../../../components/map/apiPaths';
import {
condPartField, getCelClusters,   OP_DISPLAY, overlayRowWithTemplate,
  tokensFromTemplate, tokensToCelInner, tokensToTemplate, typeCompatibility, validateCelInner,
} from './celUtils';
import {
  CANVAS_SIZE, DRAFT_NODE_ID, ENV_NODE_ID, HEADER_H, HG, K8S_BASE_FIELDS, K8S_MAP_PATHS,
  NODE_CFG,   nodeH, nodeIdToRef, NW, refAccent,
ROW_H, SCHEMA_NODE_ID, USER_C_DARK, USER_C_LIGHT,
} from './constants';
import { bezierPath, buildGraph, extraPortY, makeBezier, srcPortY, tgtPortY } from './graphUtils';
import { DraftNodeCard, NodeCard } from './NodeCard';
import { applyExtraEdgesToInput, applyFieldEditsToInput, buildTemplateRows, insertRowAtPath, removeRowAtPath } from './rowUtils';
import { findArrayPaths, findMapPaths, flattenJsonSchema, getResApiVersion, getResKind, resolveSchemaRefs } from './schemaUtils';
import {
  AddForm, BuilderToken, Drawing, EdgeType, EditingRow, ExtraEdge, FieldEdit,
  FieldSuggestion, GEdge, GNode, HoverTarget, KindOption, NodeType, PendingResource,
  PickerTarget, SaveState, TokenHover, TRow,
} from './types';

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
}

export function GraphCanvas({ input, height = 480, compositionName, stepIndex, onDirtyChange, xrdSchema, mrdSchemaMap, kindOptions = [] }: GraphCanvasProps) {
  const theme        = useTheme();
  const dark         = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const userC        = dark ? USER_C_DARK : USER_C_LIGHT;

  const { nodes: initNodes, edges } = useMemo(() => buildGraph(input), [input]);

  const [nodes,        setNodes]        = useState<GNode[]>(initNodes);
  const [selected,     setSelected]     = useState<string | null>(null);
  const [pan,          setPan]          = useState({ x: 40, y: 40 });
  const [scale,        setScale]        = useState(1.0);
  const panRef   = useRef(pan);
  const scaleRef = useRef(scale);
  useEffect(() => { panRef.current = pan; });
  useEffect(() => { scaleRef.current = scale; });
  const [active,       setActive]       = useState(false);
  const [drawing,           setDrawing]           = useState<Drawing | null>(null);
  const [hoverTarget,       setHoverTarget]       = useState<HoverTarget | null>(null);
  const [drawingHoverNodeId, setDrawingHoverNodeId] = useState<string | null>(null);
  const [extraEdges,        setExtraEdges]        = useState<ExtraEdge[]>([]);

  const [saveState,     setSaveState]     = useState<SaveState>('idle');
  const [tokenHover,    setTokenHover]    = useState<TokenHover | null>(null);
  const [fieldEdits,    setFieldEdits]    = useState<FieldEdit[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [editingRow,    setEditingRow]    = useState<EditingRow | null>(null);
  const [builderTokens, setBuilderTokens] = useState<BuilderToken[]>([]);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [pickerQuery,  setPickerQuery]  = useState('');
  const [pendingResources,  setPendingResources]  = useState<PendingResource[]>([]);
  const [pendingRemovals,   setPendingRemovals]   = useState<string[]>([]);
  const [addForm,           setAddForm]           = useState<AddForm | null>(null);
  const [confirmDelete,     setConfirmDelete]     = useState<string | null>(null);
  const isDirty = extraEdges.length > 0 || fieldEdits.length > 0 || pendingResources.length > 0 || pendingRemovals.length > 0;

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
      newInput = applyExtraEdgesToInput(newInput, extraEdges);
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
      setExtraEdges([]); // cleared — now persisted in the cluster
      setFieldEdits([]);
      setPendingResources([]);
      setPendingRemovals([]);
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      console.error('Failed to patch Composition:', err);
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3500);
    }
  }, [extraEdges, fieldEdits, pendingResources, input, compositionName, stepIndex]);

  const didFit = useRef(false);
  useEffect(() => {
    setNodes(initNodes); didFit.current = false;
    setExtraEdges([]); setFieldEdits([]); setPendingResources([]); setPendingRemovals([]);
    setAddForm(null); setConfirmDelete(null);
    setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null); setEditingRow(null);
  }, [initNodes]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // ── Native K8s schema fetch ────────────────────────────────────────────────
  // Fetches OpenAPI v3 schemas for native K8s resources (Deployment, Service, …) that aren't
  // covered by the MRD schema map. Triggered whenever the set of group/version/kind triples
  // changes — including pending resources added in this session (before they are saved).

  const [nativeSchemaMap, setNativeSchemaMap] = useState<Map<string, any>>(new Map());

  const resourceGvKinds = useMemo(
    () => [...(input?.resources ?? []), ...pendingResources]
      .map((r: any) => `${getResApiVersion(r)}::${getResKind(r)}`)
      .filter((s: string) => s !== '::')
      .sort()
      .join('|'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input?.resources, pendingResources]
  );

  const mrdSchemaMapRef = useRef(mrdSchemaMap);
  useEffect(() => { mrdSchemaMapRef.current = mrdSchemaMap; });

  useEffect(() => {
    const allRes: any[] = [...(input?.resources ?? []), ...pendingResources];
    const gvToKinds = new Map<string, Array<{ mapKey: string; kind: string }>>();
    const seenMapKeys = new Set<string>();
    for (const res of allRes) {
      const apiVersion = getResApiVersion(res);
      const kind = getResKind(res);
      if (!apiVersion || !kind) continue;
      const [group, version] = getGroupVersion(apiVersion);
      const mapKey = `${group}/${kind}`;
      if (mrdSchemaMapRef.current?.has(mapKey) || seenMapKeys.has(mapKey)) continue;
      seenMapKeys.add(mapKey);
      const gvPath = group ? `apis/${group}/${version}` : `api/${version}`;
      if (!gvToKinds.has(gvPath)) gvToKinds.set(gvPath, []);
      gvToKinds.get(gvPath)!.push({ mapKey, kind });
    }
    if (!gvToKinds.size) return;

    let mounted = true;
    const result = new Map<string, any>();
    Promise.allSettled(
      [...gvToKinds.entries()].map(async ([gvPath, entries]) => {
        let doc: any;
        try {
          doc = await ApiProxy.request(`/openapi/v3/${gvPath}`);
        } catch (err) {
          console.warn('[crossplane] schema fetch failed for', gvPath, err);
          return;
        }
        const schemas: Record<string, any> = doc?.components?.schemas ?? {};
        console.log('[crossplane] schema fetch', gvPath, 'schemas:', Object.keys(schemas).length, 'looking for:', entries.map(e => e.kind));
        for (const { mapKey, kind } of entries) {
          const schema = Object.values(schemas).find((s: any) =>
            (s['x-kubernetes-group-version-kind'] ?? []).some((gvk: any) => gvk.kind === kind)
          );
          console.log('[crossplane] schema for', mapKey, schema ? 'found, top-level keys:' : 'NOT FOUND', schema ? Object.keys(schema).join(',') : '');
          if (schema) {
            const resolved = resolveSchemaRefs(schema, schemas, 12);
            console.log('[crossplane] resolved', mapKey, 'properties:', Object.keys(resolved?.properties ?? {}));
            result.set(mapKey, resolved);
          }
        }
      })
    ).then(() => {
      console.log('[crossplane] schema fetch done, result keys:', [...result.keys()]);
      if (!mounted || !result.size) return;
      setNativeSchemaMap(prev => {
        const merged = new Map(prev);
        let changed = false;
        for (const [k, v] of result) { if (!merged.has(k)) { merged.set(k, v); changed = true; } }
        return changed ? merged : prev;
      });
    });

    return () => { mounted = false; };
  // pendingResources intentionally excluded — resourceGvKinds is the stable dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceGvKinds]);

  // Merge MRD schemas (from parent) with fetched native K8s schemas
  const combinedSchemaMap = useMemo(() => {
    if (!nativeSchemaMap.size) return mrdSchemaMap;
    const merged = new Map(mrdSchemaMap ?? []);
    for (const [k, v] of nativeSchemaMap) merged.set(k, v);
    return merged;
  }, [mrdSchemaMap, nativeSchemaMap]);

  // Memoize flattened schema fields so flattenJsonSchema isn't called on every render/mouse event.
  const xrdAllFields  = useMemo(() => flattenJsonSchema(xrdSchema), [xrdSchema]);
  const xrdLeafFields = useMemo(
    () => xrdAllFields.filter(s => s.path.startsWith('spec.') && s.type !== 'object' && s.type !== 'array'),
    [xrdAllFields]
  );
  const mrdFieldsCache = useMemo(() => {
    const cache = new Map<string, FieldSuggestion[]>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, flattenJsonSchema(schema, '', 12));
    return cache;
  }, [combinedSchemaMap]);

  const mrdMapPathsCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, findMapPaths(schema));
    return cache;
  }, [combinedSchemaMap]);

  const mrdArrayPathsCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, findArrayPaths(schema));
    return cache;
  }, [combinedSchemaMap]);

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
    } else if (nodeId === ENV_NODE_ID) {
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

  /** Stable ref to knownIds — lets the token-init effect read the latest value without re-running. */
  const knownIdsRef = useRef(knownIds);
  useEffect(() => { knownIdsRef.current = knownIds; });

  /** Re-initialise builder tokens whenever the edited row identity changes. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editingRow) {
      setBuilderTokens([]); setPickerTarget(null); setPickerQuery('');
      return;
    }
    const raw = tokensFromTemplate(editingRow.currentTemplate, knownIdsRef.current);
    setBuilderTokens(raw.map((t, i) => ({ ...t, id: `t${i}${Math.random().toString(36).slice(2, 5)}` })));
    setPickerTarget(null); setPickerQuery('');
  }, [editingRow?.nodeId, editingRow?.fieldPath]);

  /** Type of any field in any node — looks up the cached schema fields, bypassing the used-path filter.
   *  Array item sub-paths like containers.0.name are translated to containers[].name for lookup. */
  const getFieldType = useCallback((nodeId: string, fieldPath: string): string | undefined => {
    if (nodeId === SCHEMA_NODE_ID) {
      return xrdAllFields.find(s => s.path === fieldPath)?.type;
    }
    if (nodeId === ENV_NODE_ID) return undefined;
    const res = (input?.resources ?? []).find((r: any) => r.id === nodeId)
      ?? pendingResources.find(r => r.id === nodeId);
    const apiVersion = getResApiVersion(res);
    const kind = getResKind(res);
    const fields = mrdFieldsCache.get(`${getGroupVersion(apiVersion)[0]}/${kind}`);
    if (!fields) return undefined;
    // Direct match first
    const direct = fields.find(s => s.path === fieldPath);
    if (direct) return direct.type;
    // Translate array item paths: containers.0.name → containers[].name
    const schemaPath = fieldPath.replace(/\.(\d+)\./g, '[].').replace(/\.(\d+)$/, '[]');
    return fields.find(s => s.path === schemaPath)?.type;
  }, [input, pendingResources, xrdAllFields, mrdFieldsCache]);

  /** All source fields across all nodes, pre-built for the picker.
   *  Schema: all XRD spec leaf fields (getSuggestions would wrongly filter out already-used ones).
   *  Resource nodes: fields with an outPort from the saved composition OR from newly drawn extraEdges. */
  const pickerSuggestions = useMemo(() => {
    type PickerEntry = { nodeId: string; nodeRef: string; nodeLabel: string; fieldPath: string; fieldType: string | undefined; nodeType: NodeType };
    const result: PickerEntry[] = [];
    const seen = new Set<string>();
    const add = (e: PickerEntry) => { const k = `${e.nodeId}::${e.fieldPath}`; if (!seen.has(k)) { seen.add(k); result.push(e); } };

    for (const n of nodes) {
      const nRef = nodeIdToRef(n.id);
      // For schema: supplement outPort rows with all XRD spec fields (if xrdSchema available).
      // xrdSchema fields are added first so they carry type info; outPort rows add any
      // pre-existing references that fall outside xrdSchema (or when xrdSchema is null).
      if (n.id === SCHEMA_NODE_ID && xrdSchema) {
        for (const f of xrdLeafFields)
          add({ nodeId: n.id, nodeRef: nRef, nodeLabel: n.label, fieldPath: f.path, fieldType: f.type, nodeType: n.type });
      }
      // All nodes: outPort rows = confirmed edges going out from this node in the saved composition
      for (const r of n.rows.filter(r => r.outPort && r.fieldPath))
        add({ nodeId: n.id, nodeRef: nRef, nodeLabel: n.label, fieldPath: r.outPort!.path,
          fieldType: getSuggestions(n.id).find(s => s.path === r.outPort!.path)?.type, nodeType: n.type });
    }

    // Also include source fields from newly drawn extraEdges (not yet in nodes state)
    for (const ee of extraEdges) {
      const srcNode = nodes.find(n => n.id === ee.srcNodeId);
      if (!srcNode) continue;
      const nRef = nodeIdToRef(srcNode.id);
      add({ nodeId: srcNode.id, nodeRef: nRef, nodeLabel: srcNode.label, fieldPath: ee.srcFieldPath,
        fieldType: getSuggestions(srcNode.id).find(s => s.path === ee.srcFieldPath)?.type, nodeType: srcNode.type });
    }

    return result;
  },
    [nodes, extraEdges, xrdSchema, xrdLeafFields, getSuggestions]
  );

  const onRowClick = useCallback((nodeId: string, fieldPath: string, currentTemplate: string) => {
    if (drawing) return;
    if (nodeMap.get(nodeId)?.type === 'kro-ref' && !fieldPath.startsWith('metadata.')) return;
    setEditingRow({ nodeId, fieldPath, currentTemplate });
  }, [drawing, nodeMap]);

  const saveEditingRow = useCallback(() => {
    if (!editingRow) return;
    const tmpl = tokensToTemplate(builderTokens).trim();
    if (!tmpl) {
      setFieldEdits(prev => prev.filter(e => !(e.nodeId === editingRow.nodeId && e.fieldPath === editingRow.fieldPath)));
    } else {
      setFieldEdits(prev => [
        ...prev.filter(e => !(e.nodeId === editingRow.nodeId && e.fieldPath === editingRow.fieldPath)),
        { nodeId: editingRow.nodeId, fieldPath: editingRow.fieldPath, template: tmpl },
      ]);
    }
    setEditingRow(null);
    setBuilderTokens([]);
    setPickerTarget(null);
  }, [editingRow, builderTokens]);

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
    const base = nodes.filter(n => n.id !== DRAFT_NODE_ID);
    if (fieldEdits.length === 0) return base;
    return base.map(node => {
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
  }, [nodes, fieldEdits, knownIds]);

  /** Pre-computed suggestions per node — stable references so NodeCard.memo can short-circuit. */
  const allSuggestionsMap = useMemo(() => {
    const map = new Map<string, FieldSuggestion[]>();
    for (const n of nodesForDisplay) map.set(n.id, getSuggestions(n.id));
    return map;
  }, [nodesForDisplay, getSuggestions]);

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

  const isPanning   = useRef(false);
  const panOrigin   = useRef({ x: 0, y: 0 });
  const bgWasClean  = useRef(false); // true if bg mousedown had no subsequent mouse movement
  const dragId      = useRef<string | null>(null);
  const dragOrigin  = useRef({ mx: 0, my: 0, nx: 0, ny: 0 });
  const hasDragged  = useRef(false); // true if the current node drag moved the pointer

  const screenToCanvas = useCallback((sx: number, sy: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (sx - r.left - panRef.current.x) / scaleRef.current, y: (sy - r.top - panRef.current.y) / scaleRef.current };
  }, []);

  // ── Add virtual field row to a node ─────────────────────────────────────────

  const addFieldToNode = useCallback((nodeId: string, fieldPath: string): boolean => {
    const path = fieldPath.trim();
    if (!path) return false;
    const isMapParent   = allMapPathsMap.get(nodeId)?.has(path) ?? false;
    const isArrayParent = allArrayPathsMap.get(nodeId)?.has(path) ?? false;
    const fieldType = getFieldType(nodeId, path);
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const leafExtra: Partial<TRow> = (isMapParent || isArrayParent)
        ? { isVirtual: true, isParent: true, ...(isArrayParent && { isArrayParent: true }) }
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
      const newRows = insertRowAtPath(n.rows, itemPath, { isParent: true, isVirtual: true });
      return { ...n, rows: newRows, h: nodeH(newRows) };
    }));
  }, []);

  // ── Hover target computation ─────────────────────────────────────────────────

  const computeHoverTarget = useCallback((cp: { x: number; y: number }, srcNodeId: string): HoverTarget | null => {
    for (const n of nodes) {
      if (n.id === srcNodeId) continue;
      if (n.type === 'kro-ref') continue; // external refs are read-only, cannot be drop targets
      if (cp.x < n.x || cp.x > n.x + n.w) continue;
      const displayBottom = n.y + HEADER_H + n.rows.length * ROW_H + 8;
      if (cp.y < n.y || cp.y >= displayBottom) continue;
      const rowIdx = Math.floor((cp.y - n.y - HEADER_H) / ROW_H);
      if (rowIdx >= 0 && rowIdx < n.rows.length && !n.rows[rowIdx].isParent) {
        return { nodeId: n.id, rowIdx, fieldPath: n.rows[rowIdx].fieldPath };
      }
    }
    return null;
  }, [nodes]);

  // ── Mouse handlers ────────────────────────────────────────────────────────────

  const onBgDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    if (editingRow) { setEditingRow(null); setBuilderTokens([]); setPickerTarget(null); return; }
    if (drawing) { setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null); return; }
    isPanning.current = true;
    bgWasClean.current = true;
    panOrigin.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    setActive(true); e.preventDefault();
  }, [pan, drawing, editingRow]);

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
      const s = scaleRef.current;
      const p = panRef.current;
      const cW = containerRef.current.clientWidth;
      const cH = containerRef.current.clientHeight;
      nx = (Math.max(8,  Math.min(n.x * s + p.x, cW - NW - 8))  - p.x) / s;
      ny = (Math.max(48, Math.min(n.y * s + p.y, cH - 240))      - p.y) / s;
      setNodes(prev => prev.map(nd => nd.id === DRAFT_NODE_ID ? { ...nd, x: nx, y: ny } : nd));
    }
    dragOrigin.current = { mx: e.clientX, my: e.clientY, nx, ny };
    setActive(true);
  }, [nodes, drawing]);

  const onPortDown = useCallback((e: MouseEvent, nodeId: string, fieldPath: string) => {
    e.stopPropagation();
    const cp = screenToCanvas(e.clientX, e.clientY);
    setDrawing({ srcNodeId: nodeId, srcFieldPath: fieldPath, canvasX: cp.x, canvasY: cp.y });
    setHoverTarget(null); setActive(true);
  }, [screenToCanvas]);

  const onPotentialFieldClick = useCallback((nodeId: string, fieldPath: string) => {
    addFieldToNode(nodeId, fieldPath);
  }, [addFieldToNode]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning.current) { bgWasClean.current = false; setPan({ x: e.clientX - panOrigin.current.x, y: e.clientY - panOrigin.current.y }); }
    if (dragId.current) {
      hasDragged.current = true;
      const dx = (e.clientX - dragOrigin.current.mx) / scale;
      const dy = (e.clientY - dragOrigin.current.my) / scale;
      setNodes(prev => prev.map(n => n.id === dragId.current
        ? { ...n, x: dragOrigin.current.nx + dx, y: dragOrigin.current.ny + dy } : n));
    }
    if (drawing) {
      const cp = screenToCanvas(e.clientX, e.clientY);
      setDrawing(d => d ? { ...d, canvasX: cp.x, canvasY: cp.y } : null);
      setHoverTarget(computeHoverTarget(cp, drawing.srcNodeId));
      // Track which node the cursor is over, independent of valid drop row
      const overNode = nodes.find(n => {
        if (n.id === drawing.srcNodeId) return false;
        if (cp.x < n.x || cp.x > n.x + n.w) return false;
        // Only env nodes have a bottom "Add field" row; kro-resource nodes use inline map-parent adding.
        const addFieldH = n.type === 'env' ? ROW_H : 0;
        const displayBottom = n.y + HEADER_H + n.rows.length * ROW_H + 8 + addFieldH;
        return cp.y >= n.y && cp.y < displayBottom;
      });
      setDrawingHoverNodeId(overNode?.id ?? null);
    }
  }, [scale, drawing, screenToCanvas, computeHoverTarget, nodes]);

  const onMouseUp = useCallback(() => {
    if (bgWasClean.current) setSelected(null);
    bgWasClean.current = false;
    isPanning.current = false; dragId.current = null; setActive(false);
    if (drawing) {
      if (hoverTarget?.fieldPath) {
        const tgtNode = nodeMap.get(hoverTarget.nodeId);
        if (tgtNode && !tgtNode.rows.some(r => r.fieldPath === hoverTarget.fieldPath)) {
          // Dropped on a ghost (potential) field row — materialise it first
          addFieldToNode(hoverTarget.nodeId, hoverTarget.fieldPath);
        }
        setExtraEdges(prev => [...prev, {
          id: `extra-${Date.now()}`,
          srcNodeId: drawing.srcNodeId, srcFieldPath: drawing.srcFieldPath,
          tgtNodeId: hoverTarget.nodeId, tgtFieldPath: hoverTarget.fieldPath,
        }]);
      }
      setDrawing(null); setHoverTarget(null); setDrawingHoverNodeId(null);
    }
  }, [drawing, hoverTarget, nodeMap, addFieldToNode]);

  // ── Zoom ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const prev = scaleRef.current;
      // Proportional zoom: small trackpad nudges → tiny zoom, large scroll → larger zoom.
      // deltaMode 1 = line units (some mouse wheels) → convert to ~pixels.
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const next = Math.max(0.15, Math.min(4, prev * Math.pow(0.999, dy)));
      const ratio = next / prev;
      // Update synchronously so rapid successive wheel events compound correctly
      // rather than all starting from the same stale render-cycle value.
      scaleRef.current = next;
      setScale(next);
      setPan(p => ({ x: px - (px - p.x) * ratio, y: py - (py - p.y) * ratio }));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  /** Zoom by `factor` keeping the canvas point at container position `(px, py)` fixed. */
  const zoomAround = useCallback((factor: number, px: number, py: number) => {
    const prev = scaleRef.current;
    const next = Math.max(0.15, Math.min(4, prev * factor));
    const ratio = next / prev;
    scaleRef.current = next;
    setScale(next);
    setPan(p => ({ x: px - (px - p.x) * ratio, y: py - (py - p.y) * ratio }));
  }, []);

  const fitView = useCallback(() => {
    if (!containerRef.current || !nodes.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + n.w));
    const maxY = Math.max(...nodes.map(n => n.y + n.h));
    const pad  = 56;
    const ns   = Math.min((rect.width - pad * 2) / Math.max(maxX - minX, 1), (rect.height - pad * 2) / Math.max(maxY - minY, 1), 1.5);
    setScale(ns);
    setPan({ x: (rect.width - (maxX - minX) * ns) / 2 - minX * ns, y: (rect.height - (maxY - minY) * ns) / 2 - minY * ns });
  }, [nodes]);

  useEffect(() => {
    if (!didFit.current && nodes.length) { didFit.current = true; requestAnimationFrame(fitView); }
  }, [nodes, fitView]);

  const edgeColors: Record<EdgeType, string> = useMemo(() => ({
    'kro-schema': dark ? '#90caf9' : '#1565c0',
    'kro-env':    dark ? '#fcd34d' : '#92660a',
    'kro-dep':    dark ? '#a5d6a7' : '#2e7d32',
    'user':       userC,
  }), [dark, userC]);

  const eid = useRef(`cne-${Math.random().toString(36).slice(2, 7)}`).current;

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
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
    setFieldEdits(prev => [
      ...prev.filter(e => !(e.nodeId === nodeId && isDescendantOrSelf(e.fieldPath))),
      { nodeId, fieldPath, template: '' },
    ]);
    // Remove extra edges that referenced this field or any of its descendants.
    setExtraEdges(prev => prev.filter(e =>
      !(e.tgtNodeId === nodeId && isDescendantOrSelf(e.tgtFieldPath)) &&
      !(e.srcNodeId === nodeId && isDescendantOrSelf(e.srcFieldPath))
    ));
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
        {([
          { title: 'Fit view',                          icon: 'mdi:fit-to-screen-outline',  action: fitView },
          { title: 'Zoom in',  icon: 'mdi:magnify-plus-outline',  action: () => { const r = containerRef.current?.getBoundingClientRect(); if (r) zoomAround(1.2, r.width / 2, r.height / 2); } },
          { title: 'Zoom out', icon: 'mdi:magnify-minus-outline', action: () => { const r = containerRef.current?.getBoundingClientRect(); if (r) zoomAround(1 / 1.2, r.width / 2, r.height / 2); } },
          { title: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', icon: isFullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen', action: toggleFullscreen },
        ] as const).map(({ title, icon, action }) => (
          <Tooltip key={title} title={title}>
            <IconButton size="small" onClick={action}
              sx={{ bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
              <Icon icon={icon} width={17} height={17} />
            </IconButton>
          </Tooltip>
        ))}
        <Tooltip title="Add resource">
          <IconButton size="small"
            onClick={() => {
              if (nodes.some(n => n.id === DRAFT_NODE_ID)) return;
              const rightmost = nodes.reduce((max, n) => Math.max(max, n.x + n.w), 0);
              setNodes(prev => [...prev, { id: DRAFT_NODE_ID, type: 'draft', label: '', rows: [], x: rightmost + HG, y: 40, w: NW, h: 220 }]);
              setAddForm({ id: '', apiVersion: '', kind: '', mode: 'template', refLookup: 'name', refName: '', refLabels: [] });
            }}
            sx={{ bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
            <Icon icon="mdi:plus" width={17} height={17} />
          </IconButton>
        </Tooltip>
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
            <IconButton size="small" onClick={() => { setExtraEdges([]); setFieldEdits([]); setPendingResources([]); setPendingRemovals([]); setAddForm(null); setConfirmDelete(null); setNodes(initNodes); }}
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
        const screenLeft = Math.max(8,  Math.min(draftNode.x * scale + pan.x, cW - NW - 8));
        const screenTop  = Math.max(48, Math.min(draftNode.y * scale + pan.y, cH - 240));
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

      {/* Scale badge */}
      <Box sx={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10, px: 1, py: 0.3, bgcolor: 'background.paper', borderRadius: 1, boxShadow: 1 }}>
        <Typography variant="caption" sx={{ opacity: 0.55, fontSize: '0.7rem' }}>{Math.round(scale * 100)}%</Typography>
      </Box>

      {/* Legend */}
      <Box sx={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, display: 'flex', gap: 1, alignItems: 'center', bgcolor: 'background.paper', borderRadius: 1, px: 1.25, py: 0.6, boxShadow: 1 }}>
        {(Object.entries(NODE_CFG) as [NodeType, typeof NODE_CFG[NodeType]][]).filter(([type]) => type !== 'draft').map(([type, cfg]) => (
          <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
            <Icon icon={cfg.icon} width={12} style={{ color: dark ? cfg.accentDark : cfg.accent }} />
            <Typography variant="caption" sx={{ fontSize: '0.64rem', opacity: 0.65 }}>{cfg.label}</Typography>
          </Box>
        ))}
        {drawing && <Typography variant="caption" sx={{ fontSize: '0.62rem', color: userC, ml: 0.5 }}>drop on an existing field or a suggested field below the node</Typography>}
      </Box>

      {/* Canvas */}
      <div style={{ position: 'absolute', transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`, transformOrigin: '0 0', width: CANVAS_SIZE, height: CANVAS_SIZE }}>
        <svg style={{ position: 'absolute', top: 0, left: 0, width: CANVAS_SIZE, height: CANVAS_SIZE, pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
          <defs>
            {(Object.keys(edgeColors) as EdgeType[]).map(type => (
              <marker key={type} id={`${eid}-${type}`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
                <polygon points="0 0,8 3,0 6" fill={edgeColors[type]} opacity={0.9} />
              </marker>
            ))}
          </defs>

          {edges.map(e => {
            const src = nodeMap.get(e.source); const tgt = nodeMap.get(e.target);
            if (!src || !tgt) return null;
            const isHov = hoveredEdgeId === e.id;
            const isLit = !!tokenHover
              && e.source === tokenHover.srcNodeId
              && e.srcPortPath === tokenHover.srcPath
              && e.target === tokenHover.tgtNodeId;
            const edgeTargetFp = getEdgeTargetFieldPath(e);
            const isDeleted = !!edgeTargetFp &&
              fieldEdits.some(fe => fe.nodeId === e.target && fe.fieldPath === edgeTargetFp && fe.template === '');
            const d = bezierPath(src, tgt, e);
            const mx = (src.x + src.w + tgt.x) / 2;
            const sy = srcPortY(src, e.srcPortPath);
            const ty = tgtPortY(tgt, e.tgtPortKey);
            const my = (sy + ty) / 2;
            const col = edgeColors[e.type];
            return (
              <g key={e.id}>
                <path d={d} fill="none" stroke={col}
                  strokeWidth={isLit ? 3 : 1.75}
                  strokeOpacity={isDeleted ? 0.2 : isLit ? 1 : tokenHover ? 0.25 : isHov ? 0.9 : 0.75}
                  strokeDasharray={isDeleted ? '4 4' : undefined}
                  markerEnd={isDeleted ? undefined : `url(#${eid}-${e.type})`}
                  style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }} />
                {/* Wide transparent hit path */}
                <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdgeId(e.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)} />
                {isHov && !isDeleted && (
                  <g transform={`translate(${mx},${my})`}
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredEdgeId(e.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                    onClick={ev => { ev.stopPropagation(); removeExistingEdge(e); setHoveredEdgeId(null); }}>
                    <circle r={8} fill={dark ? '#333' : '#fff'} stroke={col} strokeWidth={1.5} />
                    <line x1={-3} y1={-3} x2={3} y2={3} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                    <line x1={3} y1={-3} x2={-3} y2={3} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                  </g>
                )}
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
            const src = nodeMap.get(e.srcNodeId); const tgt = nodeMap.get(e.tgtNodeId);
            if (!src || !tgt) return null;
            const isHov = hoveredEdgeId === e.id;
            const isLit = !!tokenHover
              && e.srcNodeId === tokenHover.srcNodeId
              && e.srcFieldPath === tokenHover.srcPath
              && e.tgtNodeId === tokenHover.tgtNodeId;
            const sx2 = src.x + src.w; const sy2 = extraPortY(src, e.srcFieldPath);
            const tx2 = tgt.x;         const ty2 = extraPortY(tgt, e.tgtFieldPath);
            const d = makeBezier(sx2, sy2, tx2, ty2);
            const mx = (sx2 + tx2) / 2; const my = (sy2 + ty2) / 2;
            return (
              <g key={e.id}>
                <path d={d} fill="none" stroke={edgeColors.user}
                  strokeWidth={isLit ? 3 : 1.75}
                  strokeOpacity={isLit ? 1 : tokenHover ? 0.25 : isHov ? 0.9 : 0.75}
                  strokeDasharray="6 3" markerEnd={`url(#${eid}-user)`}
                  style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }} />
                {/* Wide transparent hit path */}
                <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdgeId(e.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)} />
                {isHov && (
                  <g transform={`translate(${mx},${my})`}
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredEdgeId(e.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                    onClick={ev => { ev.stopPropagation(); setExtraEdges(prev => prev.filter(ee => ee.id !== e.id)); setHoveredEdgeId(null); }}>
                    <circle r={8} fill={dark ? '#333' : '#fff'} stroke={edgeColors.user} strokeWidth={1.5} />
                    <line x1={-3} y1={-3} x2={3} y2={3} stroke={edgeColors.user} strokeWidth={1.5} strokeLinecap="round" />
                    <line x1={3} y1={-3} x2={-3} y2={3} stroke={edgeColors.user} strokeWidth={1.5} strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}

          {drawing && (() => {
            const src = nodeMap.get(drawing.srcNodeId); if (!src) return null;
            return <path d={makeBezier(src.x + src.w, extraPortY(src, drawing.srcFieldPath), drawing.canvasX, drawing.canvasY)}
              fill="none" stroke={userC} strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="5 4" />;
          })()}
        </svg>

        {nodesForDisplay.map(n => (
          <NodeCard key={n.id} node={n} selected={selected === n.id} dark={dark}
            isDrawing={!!drawing}
            hoverRowIdx={hoverTarget?.nodeId === n.id ? hoverTarget.rowIdx : undefined}
            tokenHover={tokenHover}
            onMouseDown={onNodeDown}
            onClick={onNodeClick}
            onPortDown={onPortDown}
            potentialFields={allSuggestionsMap.get(n.id) ?? []}
            isExpanded={selected === n.id || drawingHoverNodeId === n.id}
            onPotentialFieldClick={onPotentialFieldClick}
            onTokenHover={setTokenHover}
            onTokenLeave={onTokenLeave}
            onRowClick={onRowClick}
            editedPaths={editedPaths}
            onDelete={setConfirmDelete}
            onDeleteRow={onDeleteRow}
            mapParentPaths={allMapPathsMap.get(n.id)}
            arrayParentPaths={allArrayPathsMap.get(n.id)}
            onAddArrayItem={addArrayItemToNode}
            nodeTypeByRef={nodeTypeByRef}
          />
        ))}


        {/* ── Inline row-template editor: visual token builder ─────────────── */}
        {editingRow && (() => {
          const editNode = nodeMap.get(editingRow.nodeId); if (!editNode) return null;
          const rowIdx = editNode.rows.findIndex(r => r.fieldPath === editingRow.fieldPath);
          const panelX = editNode.x;
          const panelY = editNode.y + HEADER_H + (rowIdx >= 0 ? rowIdx * ROW_H + ROW_H : 0) + 4;
          const targetType = getFieldType(editingRow.nodeId, editingRow.fieldPath);

          // Enrich tokens with live type info
          const richTokens = builderTokens.map(tok =>
            tok.kind === 'ref' && !tok.fieldType
              ? { ...tok, fieldType: getFieldType(tok.nodeId ?? '', tok.fieldPath ?? '') }
              : tok
          );

          // Type warnings across all ref tokens
          const compatList = richTokens.filter(t => t.kind === 'ref').map(t => typeCompatibility(t.fieldType, targetType));
          const hasCoerce    = compatList.some(c => c === 'coerce');
          const hasIncompat  = compatList.some(c => c === 'incompatible');

          const insertToken = (tok: Omit<BuilderToken, 'id'>) => {
            if (!pickerTarget) return;
            const id = `t${Date.now()}${Math.random().toString(36).slice(2, 4)}`;
            if (pickerTarget.kind === 'main') {
              const slot = pickerTarget.slot;
              setBuilderTokens(prev => { const n = [...prev]; n.splice(slot, 0, { ...tok, id }); return n; });
            } else {
              const { tokenIdx, part, slot } = pickerTarget;
              const field = condPartField(part);
              setBuilderTokens(prev => prev.map((t, i) => {
                if (i !== tokenIdx || t.kind !== 'conditional') return t;
                const arr = [...((t[field] as BuilderToken[] | undefined) ?? [])];
                arr.splice(slot, 0, { ...tok, id });
                return { ...t, [field]: arr };
              }));
            }
            setPickerTarget(null); setPickerQuery('');
          };
          const deleteToken = (idx: number) => setBuilderTokens(prev => prev.filter((_, i) => i !== idx));
          const updateLiteral = (idx: number, text: string) =>
            setBuilderTokens(prev => prev.map((t, i) => i === idx ? { ...t, text } : t));
          const deleteCondToken = (tokenIdx: number, part: 'cond'|'then'|'else', partIdx: number) => {
            const field = condPartField(part);
            setBuilderTokens(prev => prev.map((t, i) => {
              if (i !== tokenIdx || t.kind !== 'conditional') return t;
              return { ...t, [field]: ((t[field] as BuilderToken[]|undefined) ?? []).filter((_, j) => j !== partIdx) };
            }));
          };
          const updateCondLiteral = (tokenIdx: number, part: 'cond'|'then'|'else', partIdx: number, text: string) => {
            const field = condPartField(part);
            setBuilderTokens(prev => prev.map((t, i) => {
              if (i !== tokenIdx || t.kind !== 'conditional') return t;
              return { ...t, [field]: ((t[field] as BuilderToken[]|undefined) ?? []).map((pt, j) => j === partIdx ? { ...pt, text } : pt) };
            }));
          };

          const isMainActive = (slot: number) => pickerTarget?.kind === 'main' && pickerTarget.slot === slot;
          const isCondActive = (tokenIdx: number, part: 'cond'|'then'|'else', slot: number) =>
            pickerTarget?.kind === 'cond' && pickerTarget.tokenIdx === tokenIdx && pickerTarget.part === part && pickerTarget.slot === slot;

          const slotDotSx = (active: boolean) => ({
            width: 14, height: 14, borderRadius: '50%', p: 0, flexShrink: 0,
            border: `1px dashed ${alpha(userC, active ? 0.9 : 0.35)}`,
            bgcolor: active ? alpha(userC, 0.1) : 'transparent',
            color: userC, cursor: 'pointer', lineHeight: 1, fontSize: '0.65rem',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            opacity: active ? 1 : 0.45,
            transition: 'opacity 0.1s',
            '&:hover': { opacity: 1, bgcolor: alpha(userC, 0.08) },
          } as const);

          const slotBtn = (slot: number) => (
            <Box key={`s${slot}`} component="button"
              onClick={() => { setPickerTarget({ kind: 'main', slot }); setPickerQuery(''); }}
              sx={slotDotSx(isMainActive(slot))}>+</Box>
          );
          const condSlotBtn = (tokenIdx: number, part: 'cond'|'then'|'else', slot: number) => (
            <Box key={`cs${tokenIdx}${part}${slot}`} component="button"
              onClick={() => { setPickerTarget({ kind: 'cond', tokenIdx, part, slot }); setPickerQuery(''); }}
              sx={{ ...slotDotSx(isCondActive(tokenIdx, part, slot)), width: 10, height: 10, fontSize: '0.55rem' }}>+</Box>
          );

          return (
            <Box sx={{
              position: 'absolute', left: panelX, top: panelY, width: NW + 60, zIndex: 20,
              bgcolor: 'background.paper', border: `1.5px solid ${userC}`,
              borderRadius: 1.5, boxShadow: 4, p: 1,
              display: 'flex', flexDirection: 'column', gap: 0.6,
            }}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { if (pickerTarget !== null) { setPickerTarget(null); } else { setEditingRow(null); setBuilderTokens([]); } } }}>

              {/* Header: target field path + type badge */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" noWrap sx={{ color: userC, fontSize: '0.64rem', fontWeight: 600, flex: 1, minWidth: 0 }}>
                  {editingRow.fieldPath}
                </Typography>
                {targetType && (
                  <Box component="span" sx={{
                    fontFamily: 'monospace', fontSize: '0.54rem', px: 0.45, py: 0.1, borderRadius: 0.5, flexShrink: 0,
                    bgcolor: alpha(userC, 0.08), color: userC, border: `1px solid ${alpha(userC, 0.2)}`,
                  }}>{targetType}</Box>
                )}
              </Box>

              {/* Token builder area */}
              <Box sx={{
                border: `1px solid ${alpha(userC, 0.22)}`, borderRadius: 0.75,
                p: 0.5, minHeight: 30, position: 'relative',
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.3,
                bgcolor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }}>
                {slotBtn(0)}

                {richTokens.length === 0 && (
                  <Typography variant="caption" sx={{ opacity: 0.28, fontSize: '0.6rem', fontFamily: 'monospace', mx: 0.5, userSelect: 'none' }}>
                    click + to add a source field or text
                  </Typography>
                )}

                {richTokens.map((tok, i) => {
                  if (tok.kind === 'ref') {
                    const segColor = refAccent(tok.nodeRef!, dark, nodeMap.get(tok.nodeId ?? '')?.type);
                    const compat   = typeCompatibility(tok.fieldType, targetType);
                    return (
                      <Fragment key={tok.id}>
                        <Box sx={{
                          display: 'inline-flex', alignItems: 'center', gap: 0.3, flexShrink: 0,
                          px: 0.5, py: 0.12, borderRadius: 0.5,
                          bgcolor: alpha(segColor, 0.12), color: segColor,
                          border: `1px solid ${alpha(segColor, 0.3)}`,
                          outline: compat === 'incompatible' ? `1.5px solid #ef4444` : compat === 'coerce' ? `1.5px solid #f59e0b` : 'none',
                          outlineOffset: 1,
                        }}>
                          <Icon icon={NODE_CFG[editNode.type].icon}
                            width={8} style={{ color: segColor, opacity: 0.6, flexShrink: 0 }} />
                          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1 }}>
                            {tok.fieldPath?.split('.').pop()}
                          </Typography>
                          {tok.fieldType && (
                            <Typography sx={{ fontFamily: 'monospace', fontSize: '0.5rem', opacity: 0.5, lineHeight: 1 }}>
                              {tok.fieldType}
                            </Typography>
                          )}
                          <Tooltip title={tok.optional ? 'Optional chaining on (?.path)' : 'Optional chaining off (.path)'}>
                            <Box component="span"
                              onClick={() => setBuilderTokens(prev => prev.map((t, j) => j === i ? { ...t, optional: !t.optional } : t))}
                              sx={{ cursor: 'pointer', opacity: tok.optional ? 1 : 0.25, '&:hover': { opacity: 1 }, fontSize: '0.6rem', lineHeight: 1, color: tok.optional ? segColor : 'inherit', fontFamily: 'monospace' }}>?</Box>
                          </Tooltip>
                          <Box component="span" onClick={() => deleteToken(i)}
                            sx={{ cursor: 'pointer', opacity: 0.45, '&:hover': { opacity: 1 }, fontSize: '0.65rem', lineHeight: 1 }}>×</Box>
                        </Box>
                        {slotBtn(i + 1)}
                      </Fragment>
                    );
                  }
                  // conditional token — each part is a mini token builder
                  if (tok.kind === 'conditional') {
                    const renderCondPart = (partTokens: BuilderToken[], part: 'cond'|'then'|'else', placeholder: string) => (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2, flexWrap: 'wrap',
                        border: `1px solid ${alpha(userC, 0.18)}`, borderRadius: 0.5, px: 0.3, py: 0.1, minWidth: 28 }}>
                        {condSlotBtn(i, part, 0)}
                        {partTokens.length === 0 && (
                          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.5rem', opacity: 0.3, px: 0.2 }}>{placeholder}</Typography>
                        )}
                        {partTokens.map((pt, pi) => {
                          const enriched = pt.kind === 'ref' && !pt.fieldType
                            ? { ...pt, fieldType: getFieldType(pt.nodeId ?? '', pt.fieldPath ?? '') }
                            : pt;
                          if (enriched.kind === 'ref') {
                            const pc = refAccent(enriched.nodeRef!, dark);
                            return (
                              <Fragment key={enriched.id}>
                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2, px: 0.3, py: 0.05,
                                  borderRadius: 0.4, bgcolor: alpha(pc, 0.12), border: `1px solid ${alpha(pc, 0.3)}`, color: pc }}>
                                  <Typography sx={{ fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1 }}>
                                    {enriched.nodeRef}.{enriched.fieldPath?.split('.').pop()}
                                  </Typography>
                                  <Box component="span" onClick={() => deleteCondToken(i, part, pi)}
                                    sx={{ cursor: 'pointer', opacity: 0.4, '&:hover': { opacity: 1 }, fontSize: '0.6rem', lineHeight: 1 }}>×</Box>
                                </Box>
                                {condSlotBtn(i, part, pi + 1)}
                              </Fragment>
                            );
                          }
                          if (enriched.kind === 'literal') {
                            const condOpLabel = !enriched.isString ? OP_DISPLAY[enriched.text ?? ''] : undefined;
                            if (condOpLabel !== undefined) {
                              return (
                                <Fragment key={enriched.id}>
                                  <Box sx={{
                                    display: 'inline-flex', alignItems: 'center', gap: 0.2, flexShrink: 0,
                                    px: 0.4, py: 0.05, borderRadius: 0.4,
                                    bgcolor: alpha(userC, 0.1), color: userC,
                                    border: `1px solid ${alpha(userC, 0.3)}`,
                                    fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1, fontWeight: 600,
                                  }}>
                                    {condOpLabel}
                                    <Box component="span" onClick={() => deleteCondToken(i, part, pi)}
                                      sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 1 }, fontSize: '0.55rem' }}>×</Box>
                                  </Box>
                                  {condSlotBtn(i, part, pi + 1)}
                                </Fragment>
                              );
                            }
                            return (
                              <Fragment key={enriched.id}>
                                <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                                  <input value={enriched.text ?? ''} onChange={e => updateCondLiteral(i, part, pi, e.target.value)}
                                    onMouseDown={e => e.stopPropagation()} placeholder="text"
                                    style={{ background: 'transparent', border: 'none', outline: 'none',
                                      fontFamily: 'monospace', fontSize: '0.5rem', color: 'inherit', opacity: 0.8,
                                      width: Math.max(24, Math.min(80, (enriched.text?.length ?? 0) * 6 + 14)) }} />
                                  <Box component="span" onClick={() => deleteCondToken(i, part, pi)}
                                    sx={{ cursor: 'pointer', opacity: 0.3, '&:hover': { opacity: 0.8 }, fontSize: '0.6rem', lineHeight: 1 }}>×</Box>
                                </Box>
                                {condSlotBtn(i, part, pi + 1)}
                              </Fragment>
                            );
                          }
                          return null;
                        })}
                      </Box>
                    );
                    return (
                      <Fragment key={tok.id}>
                        <Box sx={{
                          display: 'inline-flex', alignItems: 'center', gap: 0.3, flexShrink: 0, flexWrap: 'wrap',
                          px: 0.5, py: 0.2, borderRadius: 0.5,
                          border: `1px dashed ${alpha(userC, 0.35)}`,
                          bgcolor: alpha(userC, 0.04),
                        }}>
                          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.5rem', opacity: 0.45, flexShrink: 0 }}>if</Typography>
                          {renderCondPart(tok.condTokens ?? [], 'cond', 'condition')}
                          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.5rem', opacity: 0.45, flexShrink: 0 }}>then</Typography>
                          {renderCondPart(tok.thenTokens ?? [], 'then', 'value')}
                          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.5rem', opacity: 0.45, flexShrink: 0 }}>else</Typography>
                          {renderCondPart(tok.elseTokens ?? [], 'else', 'value')}
                          <Box component="span" onClick={() => deleteToken(i)}
                            sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 0.8 }, fontSize: '0.65rem', lineHeight: 1 }}>×</Box>
                        </Box>
                        {slotBtn(i + 1)}
                      </Fragment>
                    );
                  }
                  // literal token — operator chip or editable text
                  const opLabel = !tok.isString ? OP_DISPLAY[tok.text ?? ''] : undefined;
                  if (opLabel !== undefined) {
                    return (
                      <Fragment key={tok.id}>
                        <Box sx={{
                          display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0,
                          px: 0.55, py: 0.12, borderRadius: 0.5,
                          bgcolor: alpha(userC, 0.1), color: userC,
                          border: `1px solid ${alpha(userC, 0.3)}`,
                          fontFamily: 'monospace', fontSize: '0.6rem', lineHeight: 1, fontWeight: 600,
                        }}>
                          {opLabel}
                          <Box component="span" onClick={() => deleteToken(i)}
                            sx={{ cursor: 'pointer', opacity: 0.4, '&:hover': { opacity: 1 }, fontSize: '0.65rem', ml: 0.15 }}>×</Box>
                        </Box>
                        {slotBtn(i + 1)}
                      </Fragment>
                    );
                  }
                  const isNumeric = !tok.isString && (targetType === 'integer' || targetType === 'number');
                  return (
                    <Fragment key={tok.id}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                        {tok.isString && <Typography sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.4, lineHeight: 1 }}>"</Typography>}
                        <input
                          value={tok.text ?? ''}
                          onChange={e => updateLiteral(i, e.target.value)}
                          onMouseDown={e => e.stopPropagation()}
                          type={isNumeric ? 'number' : 'text'}
                          placeholder={isNumeric ? '0' : tok.isString ? 'value' : 'text'}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus={tok.text === ''}
                          style={{
                            background: 'transparent', border: 'none', outline: 'none',
                            fontFamily: 'monospace', fontSize: '0.6rem', color: 'inherit',
                            width: Math.max(32, Math.min(96, (tok.text?.length ?? 0) * 6.5 + 18)),
                            opacity: 0.75,
                          }}
                        />
                        {tok.isString && <Typography sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.4, lineHeight: 1 }}>"</Typography>}
                        <Box component="span" onClick={() => deleteToken(i)}
                          sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 0.8 }, fontSize: '0.65rem', lineHeight: 1 }}>×</Box>
                      </Box>
                      {slotBtn(i + 1)}
                    </Fragment>
                  );
                })}

                {/* Picker: flat list of concrete field references from source nodes */}
                {pickerTarget !== null && (() => {
                  const incomingSrcIds = new Set([
                    ...edges.filter(e => e.target === editingRow.nodeId).map(e => e.source),
                    ...extraEdges.filter(ee => ee.tgtNodeId === editingRow.nodeId).map(ee => ee.srcNodeId),
                  ]);
                  const allRefs = pickerSuggestions.filter(s =>
                    s.nodeId !== editingRow.nodeId &&
                    incomingSrcIds.has(s.nodeId) &&
                    (!pickerQuery ||
                      `${s.nodeRef}.${s.fieldPath}`.toLowerCase().includes(pickerQuery.toLowerCase()))
                  );
                  return (
                    <Box sx={{
                      position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', zIndex: 30,
                      bgcolor: 'background.paper', border: `1px solid ${alpha(userC, 0.28)}`,
                      borderRadius: 0.75, boxShadow: 4,
                      display: 'flex', flexDirection: 'column', maxHeight: 220, overflow: 'hidden',
                    }}>
                      {/* Search input only */}
                      <Box sx={{ px: 0.75, py: 0.4, borderBottom: `1px solid ${alpha(userC, 0.1)}` }}>
                        <input
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          value={pickerQuery}
                          onChange={e => setPickerQuery(e.target.value)}
                          placeholder="filter…"
                          onMouseDown={e => e.stopPropagation()}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setPickerTarget(null); }}
                          style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: 'monospace', fontSize: '0.62rem', color: 'inherit' }}
                        />
                      </Box>
                      {/* Flat field list + literal/conditional items at the bottom */}
                      <Box sx={{ overflowY: 'auto', flex: 1 }}>
                        {allRefs.slice(0, 40).map(s => {
                          const sColor = refAccent(s.nodeRef, dark);
                          const compat = typeCompatibility(s.fieldType, targetType);
                          return (
                            <Box key={`${s.nodeId}::${s.fieldPath}`}
                              onMouseDown={e => { e.preventDefault(); insertToken({ kind: 'ref', nodeId: s.nodeId, nodeRef: s.nodeRef, fieldPath: s.fieldPath, fieldType: s.fieldType }); }}
                              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.28, cursor: 'pointer', '&:hover': { bgcolor: alpha(sColor, 0.07) } }}>
                              <Icon icon={NODE_CFG[s.nodeType as NodeType].icon} width={9} style={{ color: sColor, flexShrink: 0 }} />
                              <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.61rem', flex: 1 }}>
                                <Box component="span" sx={{ color: sColor, fontWeight: 600 }}>{s.nodeRef}</Box>
                                <Box component="span" sx={{ opacity: 0.5 }}>.</Box>
                                <Box component="span" sx={{ color: 'text.primary' }}>{s.fieldPath}</Box>
                              </Typography>
                              {s.fieldType && <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.54rem', opacity: 0.4, flexShrink: 0 }}>{s.fieldType}</Typography>}
                              {compat === 'ok' && targetType && s.fieldType && <Icon icon="mdi:check-circle-outline" width={9} style={{ color: '#22c55e', flexShrink: 0 }} />}
                              {compat === 'coerce' && <Tooltip title="Type coercion may be needed (e.g. string())"><span><Icon icon="mdi:alert-outline" width={9} style={{ color: '#f59e0b', flexShrink: 0 }} /></span></Tooltip>}
                              {compat === 'incompatible' && <Tooltip title="Incompatible types — expression may fail"><span><Icon icon="mdi:alert-circle-outline" width={9} style={{ color: '#ef4444', flexShrink: 0 }} /></span></Tooltip>}
                            </Box>
                          );
                        })}
                        {allRefs.length === 0 && (
                          <Typography variant="caption" sx={{ display: 'block', px: 1, py: 0.75, opacity: 0.35, fontSize: '0.6rem' }}>
                            no matching fields
                          </Typography>
                        )}
                        {/* Operators */}
                        <Box sx={{ borderTop: `1px solid ${alpha(userC, 0.08)}`, px: 0.75, pt: 0.35, pb: 0.3 }}>
                          <Typography variant="caption" sx={{ display: 'block', opacity: 0.35, fontSize: '0.52rem', fontFamily: 'monospace', mb: 0.25 }}>operators</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3 }}>
                            {(Object.entries(OP_DISPLAY) as [string, string][]).map(([raw, label]) => (
                              <Box key={raw} component="span"
                                onMouseDown={e => { e.preventDefault(); insertToken({ kind: 'literal', text: raw }); }}
                                sx={{ fontFamily: 'monospace', fontSize: '0.6rem', fontWeight: 600, px: 0.5, py: 0.1, borderRadius: 0.5,
                                  border: `1px solid ${alpha(userC, 0.25)}`, cursor: 'pointer', color: userC,
                                  '&:hover': { bgcolor: alpha(userC, 0.08) } }}>
                                {label}
                              </Box>
                            ))}
                          </Box>
                        </Box>
                        {/* Literal / conditional options as list items */}
                        <Box sx={{ borderTop: `1px solid ${alpha(userC, 0.08)}`, mt: 0 }}>
                          {targetType === 'boolean' ? (
                            (['true', 'false'] as const).map(bv => (
                              <Box key={bv} onMouseDown={e => { e.preventDefault(); insertToken({ kind: 'literal', text: bv }); }}
                                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.28, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.06) } }}>
                                <Icon icon="mdi:alpha-b-box-outline" width={9} style={{ color: userC, opacity: 0.5, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.61rem', color: 'text.primary' }}>{bv}</Typography>
                              </Box>
                            ))
                          ) : (targetType === 'integer' || targetType === 'number') ? (
                            <Box onMouseDown={e => { e.preventDefault(); insertToken({ kind: 'literal', text: '' }); }}
                              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.28, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.06) } }}>
                              <Icon icon="mdi:numeric" width={9} style={{ color: userC, opacity: 0.5, flexShrink: 0 }} />
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.61rem', color: 'text.primary' }}>number literal</Typography>
                            </Box>
                          ) : (
                            <Box onMouseDown={e => { e.preventDefault(); insertToken({ kind: 'literal', text: '', isString: true }); }}
                              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.28, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.06) } }}>
                              <Icon icon="mdi:format-text" width={9} style={{ color: userC, opacity: 0.5, flexShrink: 0 }} />
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.61rem', color: 'text.primary' }}>text literal</Typography>
                            </Box>
                          )}
                          <Box onMouseDown={e => { e.preventDefault(); insertToken({ kind: 'conditional', condTokens: [], thenTokens: [], elseTokens: [] }); }}
                            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.28, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.06) } }}>
                            <Icon icon="mdi:source-branch" width={9} style={{ color: userC, opacity: 0.5, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.61rem', color: 'text.primary' }}>if / else</Typography>
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  );
                })()}
              </Box>

              {/* Type warning */}
              {(hasCoerce || hasIncompat) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <Icon icon={hasIncompat ? 'mdi:alert-circle-outline' : 'mdi:alert-outline'} width={10}
                    style={{ color: hasIncompat ? '#ef4444' : '#f59e0b', flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontSize: '0.57rem', color: hasIncompat ? '#ef4444' : '#f59e0b' }}>
                    {hasIncompat
                      ? 'type mismatch — expression may fail at runtime'
                      : `types differ — coercion may be needed (e.g. string(…))`}
                  </Typography>
                </Box>
              )}

              {/* Raw CEL preview + validation */}
              {builderTokens.length > 0 && (() => {
                const preview = tokensToTemplate(builderTokens);
                const clusters = getCelClusters(builderTokens);
                const celErr = clusters.length
                  ? clusters.map(c => validateCelInner(tokensToCelInner(c))).find(e => e !== null) ?? null
                  : null;
                return (
                  <>
                    <Box sx={{ display: 'flex', gap: 0.3, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Typography variant="caption" sx={{ fontSize: '0.55rem', opacity: 0.4, flexShrink: 0 }}>CEL:</Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.57rem', opacity: 0.5, wordBreak: 'break-all' }}>
                        {preview}
                      </Typography>
                    </Box>
                    {clusters.length > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                        <Icon
                          icon={celErr ? 'mdi:alert-circle-outline' : 'mdi:check-circle-outline'}
                          width={10}
                          style={{ color: celErr ? '#ef4444' : '#22c55e', flexShrink: 0 }}
                        />
                        <Typography variant="caption" sx={{ fontSize: '0.57rem', color: celErr ? '#ef4444' : '#22c55e' }}>
                          {celErr ?? 'valid CEL expression'}
                        </Typography>
                      </Box>
                    )}
                  </>
                );
              })()}

              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                <Box component="button" onClick={saveEditingRow}
                  sx={{ border: `1px solid ${alpha(userC, 0.4)}`, borderRadius: 0.75, bgcolor: alpha(userC, 0.08), color: userC, fontSize: '0.64rem', px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: alpha(userC, 0.18) } }}>
                  ✓ Save
                </Box>
                <Box component="button" onClick={() => { setEditingRow(null); setBuilderTokens([]); setPickerTarget(null); }}
                  sx={{ border: `1px solid ${alpha(dark ? '#666' : '#ccc', 0.5)}`, borderRadius: 0.75, bgcolor: 'transparent', color: dark ? '#888' : '#555', fontSize: '0.64rem', px: 0.75, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' } }}>
                  ✕ Cancel
                </Box>
                <Typography variant="caption" sx={{ opacity: 0.35, fontSize: '0.56rem', ml: 0.25 }}>Esc</Typography>
              </Box>
            </Box>
          );
        })()}
      </div>
    </Box>
  );
}
