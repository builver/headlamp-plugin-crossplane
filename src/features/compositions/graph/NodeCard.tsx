import { Icon } from '@iconify/react';
import { Autocomplete, Box, Button, IconButton, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Fragment, memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DOT, HEADER_H, NODE_CFG, NODE_MIN_H, refAccent, refToNodeId, ROW_H, USER_C_DARK, USER_C_LIGHT } from './constants';
import { PortDot } from './PortDot';
import { sectionOf, sectionRelPath } from './sectionDefs';
import { SegmentedControl } from './SegmentedControl';
import { AddForm, FieldSuggestion, GNode, KindOption, NodeType, TokenHover, TRow } from './types';
import { abbrevType } from './typeUtils';
import { VarPill } from './VarPill';

function normalizePath(p: string) { return p.trim().replace(/\[(\d+)\]/g, '.$1'); }

export type { SegmentedControlProps } from './SegmentedControl';
export { SegmentedControl } from './SegmentedControl';
export { PortDot } from './PortDot';
export type { VarPillProps } from './VarPill';
export { VarPill } from './VarPill';

// ── NodeCard ──────────────────────────────────────────────────────────────────

export interface NodeCardProps {
  node: GNode;
  selected: boolean;
  dark: boolean;
  isDrawing: boolean;
  /** rowIdx >= node.rows.length → potential field row highlighted during edge drag. */
  hoverRowIdx?: number;
  onMouseDown: (e: MouseEvent, id: string) => void;
  onClick: (id: string) => void;
  onPortDown: (e: MouseEvent, nodeId: string, fieldPath: string) => void;
  /** Schema fields not yet present on this node. Used for autocomplete (and ghost rows during edge drag). */
  potentialFields: FieldSuggestion[];
  /** All schema fields for this node (including object-type), minus used paths. Used by the inline field picker. */
  allSchemaFields?: FieldSuggestion[];
  /** True when the node is selected OR is the current edge-drag hover target. */
  isExpanded: boolean;
  onPotentialFieldClick: (nodeId: string, fieldPath: string) => void;
  onTokenHover: (th: TokenHover) => void;
  onTokenLeave: () => void;
  editedPaths: Set<string>;
  onDelete?: (nodeId: string) => void;
  /** Called when the user deletes a field row from a node. */
  onDeleteRow?: (nodeId: string, fieldPath: string) => void;
  /** Paths within this node that are map types — inline "Add field" appears here. */
  mapParentPaths?: Set<string>;
  /** Paths within this node that are array containers — inline "Add item" appears here. */
  arrayParentPaths?: Set<string>;
  /** Called when the user clicks "+" on an array parent row to add the next indexed item. */
  onAddArrayItem?: (nodeId: string, arrayPath: string) => void;
  /** Maps CEL ref identifier → NodeType for all nodes, used to colour source-node pills correctly. */
  nodeTypeByRef?: Map<string, NodeType>;
  /** Field paths on this node that are not found in the CRD/XRD schema — shown with a warning icon. */
  unknownFieldPaths?: Set<string>;
  /** True when this node's schema could not be loaded — shown with a warning in the header. */
  noSchemaWarning?: boolean;
  /** Paths where x-kubernetes-preserve-unknown-fields: true — free-form input at those paths. */
  preserveUnknownParentPaths?: Set<string>;
  /** Called when the user clicks the `?` toggle on an inPort pill. */
  onToggleInPortOptional?: (nodeId: string, fieldPath: string) => void;
  /** Called when the user clicks "+" on a forEach / includeWhen / readyWhen section header. */
  onAddSectionItem?: (nodeId: string, section: string, varName?: string) => void;
  /** Called when the user clicks a port dot to delete all edges connected to it. */
  onPortClick?: (nodeId: string, fieldPath: string) => void;
  /**
   * fieldPath → source-node accent color for ExtraEdges targeting this node that are
   * not yet saved (so not reflected in row.inPort). Used to show the left dot for
   * unsaved connections from regular nodes and op nodes.
   */
  activeInPaths?: Map<string, { color: string; label: string; srcNodeId: string; srcFieldPath: string }>;
  /** fieldPaths on this node that have outgoing ExtraEdges (not yet reflected in row.outPort). */
  activeOutPaths?: Set<string>;
  /** fieldPath → op-node label/type for op-node output connections. Used to render VarPills on celExpr rows. */
  opConnectedFields?: Map<string, { label: string; type?: string; srcNodeId: string }>;
  /** Called when the user edits a plain (non-connected) field value inline. */
  onValueEdit?: (nodeId: string, fieldPath: string, value: string) => void;
  /** When true, the node is faded because it is not related to the selected node. */
  dimmed?: boolean;
}

export const NodeCard = memo(function NodeCard({
  node, selected, dark, isDrawing, hoverRowIdx,
  onMouseDown, onClick, onPortDown, potentialFields, allSchemaFields, isExpanded,
  onPotentialFieldClick, onTokenHover, onTokenLeave, editedPaths, onDelete, onDeleteRow, mapParentPaths, arrayParentPaths, onAddArrayItem, nodeTypeByRef, unknownFieldPaths, noSchemaWarning, preserveUnknownParentPaths, onToggleInPortOptional, onAddSectionItem, onPortClick, activeInPaths, activeOutPaths, opConnectedFields, onValueEdit,
  dimmed,
}: NodeCardProps) {
  const cfg   = NODE_CFG[node.type];
  const accent = dark ? cfg.accentDark : cfg.accent;
  const userC  = dark ? USER_C_DARK : USER_C_LIGHT;
  const [hovered,           setHovered]           = useState(false);
  const [addingToParentPath, setAddingToParentPath] = useState<string | null>(null);
  const [addFieldInput,  setAddFieldInput]  = useState('');
  const [addSuggIdx,     setAddSuggIdx]     = useState(-1);
  const [addingToMap,       setAddingToMap]       = useState<string | null>(null);
  const [addMapKey,         setAddMapKey]         = useState('');
  const [addingSectionKey,  setAddingSectionKey]  = useState<string | null>(null);
  const [sectionVarInput,   setSectionVarInput]   = useState('');
  const [addingForEachSubVarPath, setAddingForEachSubVarPath] = useState<string | null>(null);
  const [subFieldInput,           setSubFieldInput]           = useState('');
  const [hoveredRowPath,    setHoveredRowPath]    = useState<string | null>(null);
  const [editingRowPath,    setEditingRowPath]    = useState<string | null>(null);
  const [editingValue,      setEditingValue]      = useState('');

  const commitValueEdit = (rowPath: string, value: string) => {
    if (value !== '' && onValueEdit) onValueEdit(node.id, rowPath, value);
    setEditingRowPath(null);
    setEditingValue('');
  };

  useEffect(() => {
    if (!isExpanded && node.type !== 'env' && !noSchemaWarning) { setAddingToParentPath(null); setAddFieldInput(''); setAddSuggIdx(-1); setAddingToMap(null); setAddMapKey(''); setAddingSectionKey(null); setSectionVarInput(''); setAddingForEachSubVarPath(null); setSubFieldInput(''); setEditingRowPath(null); setEditingValue(''); }
  }, [isExpanded, node.type, noSchemaWarning]); // node.type is stable per instance; listed to satisfy exhaustive-deps

  const commitInlineAdd = (relativeKey: string) => {
    const key = relativeKey.trim();
    if (!key) return;
    const fullPath = addingToParentPath ? `${addingToParentPath}.${key}` : key;
    onPotentialFieldClick(node.id, normalizePath(fullPath));
    setAddingToParentPath(null); setAddFieldInput(''); setAddSuggIdx(-1);
  };

  const showPotentialDots = hovered || isDrawing;
  const displayRows = node.rows;
  // env: free-form add always; no-schema nodes: free-form add always; resource/ref: schema-autocomplete add when expanded (not during edge draw)
  const freeFormAdd = node.type === 'env' || !!noSchemaWarning;
  const showAddButton = freeFormAdd || (isExpanded && !isDrawing && (node.type === 'kro-resource' || node.type === 'kro-ref' || node.type === 'schema'));
  // Sections that could be added but don't yet exist on this node
  const canAddSections = isExpanded && !isDrawing && !!onAddSectionItem && node.type === 'kro-resource';
  const missingSections: Array<'forEach' | 'includeWhen' | 'readyWhen'> = canAddSections
    ? (['forEach', 'includeWhen', 'readyWhen'] as const).filter(s => !displayRows.some(r => r.isSection && r.key === s))
    : [];
  const showSectionAdd = missingSections.length > 0;
  // addingSectionKey adds a row only when showing inside an existing section header
  const addingSectionKeyInHeader = !!addingSectionKey && displayRows.some(r => r.isSection && r.key === addingSectionKey);
  const displayH = (displayRows.length === 0 ? NODE_MIN_H : HEADER_H + displayRows.length * ROW_H + 8) + (addingToParentPath !== null ? ROW_H : 0) + (addingSectionKeyInHeader ? ROW_H : 0) + (showSectionAdd ? ROW_H : 0) + (addingForEachSubVarPath !== null ? ROW_H : 0);

  // Shared helper: index of the last row in displayRows that is a descendant of the row at fp.
  const lastDescendantIdx = useCallback((fp: string): number => {
    const parentIdx = displayRows.findIndex(r => r.fieldPath === fp);
    if (parentIdx < 0) return displayRows.length - 1;
    const parentDepth = displayRows[parentIdx].depth;
    let last = parentIdx;
    for (let i = parentIdx + 1; i < displayRows.length; i++) {
      if (displayRows[i].depth > parentDepth) last = i; else break;
    }
    return last;
  }, [displayRows]);

  // Index in displayRows after which to render the inline map-key input row.
  const addInputAfterIdx      = useMemo(() => addingToMap ? lastDescendantIdx(addingToMap) : -1, [addingToMap, lastDescendantIdx]);
  // Index in displayRows after which to render the inline field picker row.
  const addParentInputAfterIdx = useMemo(() => (addingToParentPath !== null && addingToParentPath !== '') ? lastDescendantIdx(addingToParentPath) : -1, [addingToParentPath, lastDescendantIdx]);
  // Index in displayRows after which to inject the forEach sub-field inline input.
  const addForEachSubAfterIdx  = useMemo(() => addingForEachSubVarPath ? lastDescendantIdx(addingForEachSubVarPath) : -1, [addingForEachSubVarPath, lastDescendantIdx]);

  // Inline field picker: options filtered to direct children of the active parent path.
  // Uses allSchemaFields (includes object-type fields) when available; falls back to potentialFields.
  const inlineOptions = useMemo(() => {
    if (addingToParentPath === null) return [] as FieldSuggestion[];
    const pfx = addingToParentPath ? `${addingToParentPath}.` : '';
    const source = allSchemaFields ?? potentialFields;
    return source.filter(s => s.path.startsWith(pfx) && s.path.slice(pfx.length).split('.').length === 1);
  }, [addingToParentPath, potentialFields, allSchemaFields]);

  const filteredInlineOptions = useMemo(() => {
    const pfx = addingToParentPath ? `${addingToParentPath}.` : '';
    if (!addFieldInput) return inlineOptions.slice(0, 30);
    const q = addFieldInput.toLowerCase();
    return inlineOptions.filter(s => s.path.slice(pfx.length).toLowerCase().includes(q)).slice(0, 30);
  }, [inlineOptions, addFieldInput, addingToParentPath]);

  // Free-form input when: no schema, preserve-unknown path, or no suggestions at this level.
  const isFreeFormInline = noSchemaWarning
    || (addingToParentPath !== null && addingToParentPath !== '' && (preserveUnknownParentPaths?.has(addingToParentPath) ?? false))
    || inlineOptions.length === 0;


  return (
    <div
      role="button" tabIndex={0}
      data-node-id={node.id}
      style={{ position: 'absolute', left: node.x, top: node.y, width: node.w, height: displayH,
        cursor: isDrawing ? 'crosshair' : 'grab', zIndex: 2,
        opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.15s' }}
      onMouseDown={e => { e.stopPropagation(); onMouseDown(e, node.id); }}
      onClick={e => { e.stopPropagation(); onClick(node.id); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(node.id); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Port circles for rows */}
      {/* Port dots — unified over displayRows (includes ghost rows in their merged position) */}
      {displayRows.map((row, i) => {
        const top = HEADER_H + (showSectionAdd ? ROW_H : 0) + i * ROW_H + ROW_H / 2 - DOT / 2;
        // Left (inPort) dot — shown when there's a committed CEL ref OR an unsaved ExtraEdge.
        const inColor = row.inPort
          ? refAccent(row.inPort.ref, dark)
          : (activeInPaths?.get(row.fieldPath ?? '')?.color ?? null);
        const leftDot = inColor
          ? <PortDot key={`in-${i}`} color={inColor} right={false} top={top} dark={dark}
              hasConnection isDrawing={isDrawing} defaultCursor="pointer"
              onClick={e => { e.stopPropagation(); if (!isDrawing) onPortClick?.(node.id, row.fieldPath!); }}
            />
          : null;
        // Right (outPort) dot — shown when the row has an exportable field.
        const isConf  = !!row.outPort;
        const isGhost = !!row.isGhost;
        const isPot   = !isConf && !!row.fieldPath;
        const virtC   = row.isVirtual ? userC : (dark ? '#555' : '#bbb');
        const showR   = !row.isSection && row.canExport !== false && (isConf || ((isPot || row.isVirtual) && showPotentialDots && !isGhost));
        const hasOutConn = isConf || !!(row.fieldPath && activeOutPaths?.has(row.fieldPath));
        const rightDot = showR ? (
          <PortDot key={`out-${i}`}
            color={isConf ? accent : virtC} right top={top} dark={dark}
            hasConnection={hasOutConn} isDrawing={isDrawing}
            onMouseDown={e => { e.stopPropagation(); onPortDown(e, node.id, row.fieldPath!); }}
          />
        ) : null;
        return <Fragment key={i}>{leftDot}{rightDot}</Fragment>;
      })}

      {displayRows.length === 0 && (
        <PortDot color={accent} right top={node.h / 2 - DOT / 2} dark={dark}
          hasConnection={false} isDrawing={isDrawing} />
      )}

      <Paper elevation={selected ? 8 : 2} sx={{
        width: '100%', height: displayH,
        border: `2px solid ${selected ? accent : alpha(accent, 0.55)}`,
        borderRadius: 1.5, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        background: dark
          ? `linear-gradient(140deg, ${alpha(accent, 0.22)} 0%, #1c1c1c 100%)`
          : `linear-gradient(140deg, ${alpha(accent, 0.07)} 0%, #fff 100%)`,
        boxShadow: selected ? `0 0 0 3px ${alpha(accent, 0.35)}` : undefined,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      }}>
        {/* Header */}
        <Box sx={{
          px: 1.5, height: HEADER_H, flexShrink: 0,
          background: dark ? alpha(accent, 0.28) : alpha(accent, 0.1),
          borderBottom: displayRows.length > 0 ? `1px solid ${alpha(accent, 0.2)}` : 'none',
          display: 'flex', alignItems: 'center', gap: 0.75,
        }}>
          <Icon icon={cfg.icon} width={14} style={{ color: accent, flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" fontWeight={700} noWrap display="block"
              sx={{ color: accent, fontSize: '0.72rem', lineHeight: 1 }}>{node.label}</Typography>
          </Box>
          {noSchemaWarning && (
            <Tooltip title="Schema unavailable — field validation disabled" placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
              <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                <Icon icon="mdi:alert-circle-outline" width={11} style={{ color: '#f59e0b' }} />
              </span>
            </Tooltip>
          )}
          {selected && (node.type === 'kro-resource' || node.type === 'kro-ref') && onDelete && (
            <Box component="span" role="button" tabIndex={-1}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDelete(node.id); }}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: 0.5, flexShrink: 0,
                color: alpha(accent, 0.6), cursor: 'pointer',
                '&:hover': { color: '#ef4444', bgcolor: alpha('#ef4444', 0.12) },
              }}>
              <Icon icon="mdi:trash-can-outline" width={12} />
            </Box>
          )}
          {showAddButton && (
            <Box component="span" role="button" tabIndex={-1}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setAddingToParentPath(prev => prev === '' ? null : ''); setAddFieldInput(''); setAddSuggIdx(-1); }}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: 0.5, flexShrink: 0,
                color: addingToParentPath === '' ? userC : alpha(accent, 0.6), cursor: 'pointer',
                bgcolor: addingToParentPath === '' ? alpha(userC, 0.12) : 'transparent',
                '&:hover': { color: userC, bgcolor: alpha(userC, 0.12) },
              }}>
              <Icon icon="mdi:plus" width={12} />
            </Box>
          )}
        </Box>

        {showSectionAdd && (
          <Box sx={{
            height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center',
            borderBottom: `1px dashed ${alpha(accent, 0.2)}`,
            px: 1, gap: 0.5,
          }}
            onMouseDown={e => e.stopPropagation()}
          >
            {addingSectionKey === 'forEach' && missingSections.includes('forEach') ? (
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                placeholder="forEach var name"
                value={sectionVarInput}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC, paddingLeft: '4px' }}
                onChange={e => setSectionVarInput(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    const name = sectionVarInput.trim();
                    if (name) onAddSectionItem!(node.id, 'forEach', name);
                    setAddingSectionKey(null); setSectionVarInput('');
                  } else if (e.key === 'Escape') {
                    setAddingSectionKey(null); setSectionVarInput('');
                  }
                }}
              />
            ) : (
              <>
                <Icon icon="mdi:plus" width={9} style={{ color: accent, flexShrink: 0, opacity: 0.6 }} />
                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.58rem', color: accent, opacity: 0.6, mr: 0.25 }}>section:</Typography>
                {missingSections.map(sec => (
                  <Box key={sec} component="span" role="button" tabIndex={-1}
                    onClick={e => {
                      e.stopPropagation();
                      if (sec === 'forEach') { setAddingSectionKey('forEach'); setSectionVarInput(''); }
                      else { onAddSectionItem!(node.id, sec); }
                    }}
                    sx={{ display: 'inline-flex', alignItems: 'center', px: 0.5, py: 0.1, borderRadius: 0.3, cursor: 'pointer', fontSize: '0.58rem', fontFamily: 'monospace', color: accent, opacity: 0.65, border: `1px solid ${alpha(accent, 0.35)}`, '&:hover': { opacity: 1, bgcolor: alpha(accent, 0.1) } }}>
                    {sec}
                  </Box>
                ))}
              </>
            )}
          </Box>
        )}

        {/* Rows — unified render of displayRows (includes ghost rows at correct hierarchy positions) */}
        {(() => {
          const mapParentDepth = displayRows.find(r => r.fieldPath === addingToMap && r.isParent)?.depth ?? 0;
          const mapInputIndent = 8 + (mapParentDepth + 1) * 10;
          // Inline field picker input row (injected after parent's last child, or before all rows for top-level)
          const inlineParentRow = addingToParentPath !== null && addingToParentPath !== ''
            ? displayRows.find(r => r.fieldPath === addingToParentPath && r.isParent)
            : undefined;
          const inlinePickerDepth = inlineParentRow ? inlineParentRow.depth + 1 : 0;
          const inlinePickerIndent = 8 + inlinePickerDepth * 10;
          const inlinePickerInput = addingToParentPath !== null ? (
            <Box key="inline-picker-input" sx={{ height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center', borderTop: `1px dashed ${alpha(userC, 0.3)}` }}
              onMouseDown={e => e.stopPropagation()}
            >
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                placeholder={isFreeFormInline ? 'field name' : 'type a field…'}
                value={addFieldInput}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC, paddingLeft: `${inlinePickerIndent}px` }}
                onChange={e => { setAddFieldInput(e.target.value); setAddSuggIdx(-1); }}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAddSuggIdx(idx => Math.min(idx + 1, filteredInlineOptions.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setAddSuggIdx(idx => Math.max(idx - 1, -1)); }
                  else if (e.key === 'Enter') {
                    if (!isFreeFormInline && addSuggIdx >= 0 && filteredInlineOptions[addSuggIdx]) {
                      const pfx = addingToParentPath ? `${addingToParentPath}.` : '';
                      commitInlineAdd(filteredInlineOptions[addSuggIdx].path.slice(pfx.length));
                    } else {
                      commitInlineAdd(addFieldInput.trim());
                    }
                  }
                  else if (e.key === 'Escape') { setAddingToParentPath(null); setAddFieldInput(''); setAddSuggIdx(-1); }
                }}
                onBlur={() => { setTimeout(() => { setAddingToParentPath(null); setAddFieldInput(''); setAddSuggIdx(-1); }, 150); }}
              />
            </Box>
          ) : null;
          const inlineMapInput = addingToMap ? (
            <Box key="inline-map-input" sx={{ height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center', borderTop: `1px dashed ${alpha(userC, 0.3)}` }}
              onMouseDown={e => e.stopPropagation()}
            >
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                placeholder="key name"
                value={addMapKey}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC, paddingLeft: `${mapInputIndent}px` }}
                onChange={e => setAddMapKey(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    const key = addMapKey.trim();
                    if (key) onPotentialFieldClick(node.id, `${addingToMap}.${key}`);
                    setAddingToMap(null); setAddMapKey('');
                  } else if (e.key === 'Escape') {
                    setAddingToMap(null); setAddMapKey('');
                  }
                }}
                onBlur={() => { setAddingToMap(null); setAddMapKey(''); }}
              />
            </Box>
          ) : null;

          const inlineForEachSubInput = addingForEachSubVarPath ? (() => {
            const varName = sectionRelPath(addingForEachSubVarPath);
            const varRow = displayRows.find(r => r.fieldPath === addingForEachSubVarPath);
            const subIndent = 8 + ((varRow ? varRow.depth + 1 : 2)) * 10;
            return (
              <Box key="inline-foreach-sub-input" sx={{ height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center', borderTop: `1px dashed ${alpha(userC, 0.3)}` }}
                onMouseDown={e => e.stopPropagation()}>
                <input
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  placeholder="field name"
                  value={subFieldInput}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC, paddingLeft: `${subIndent}px` }}
                  onChange={e => setSubFieldInput(e.target.value)}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      const sub = subFieldInput.trim();
                      if (sub) onAddSectionItem!(node.id, 'forEach', varName + '.' + sub);
                      setAddingForEachSubVarPath(null); setSubFieldInput('');
                    } else if (e.key === 'Escape') {
                      setAddingForEachSubVarPath(null); setSubFieldInput('');
                    }
                  }}
                  onBlur={() => { setTimeout(() => { setAddingForEachSubVarPath(null); setSubFieldInput(''); }, 150); }}
                />
              </Box>
            );
          })() : null;

          const rows = displayRows.map((row: TRow, i: number) => {
          const indent     = 8 + row.depth * 10;
          const hasIn      = !!row.inPort;
          const hasOut     = !!row.outPort;
          const hasSeg     = !!row.segments?.length;
          const hasCelExpr = !!row.celExpr;
          const pa         = hasIn ? refAccent(row.inPort!.ref, dark, nodeTypeByRef?.get(row.inPort!.ref)) : accent;
          const activeInInfo = !hasIn && !hasSeg && !hasCelExpr && row.fieldPath ? (activeInPaths?.get(row.fieldPath) ?? null) : null;
          const hasActiveIn  = !!activeInInfo;
          const isVirt     = !!row.isVirtual;
          const isGhost    = !!row.isGhost;
          const isHov      = i === hoverRowIdx && !row.isParent;
          const isEdited   = !row.isParent && !!row.fieldPath && editedPaths.has(node.id + '::' + row.fieldPath);
          const amberC     = dark ? '#ffd54f' : '#f57f17';
          const isEditable = isExpanded && !isDrawing && !row.isParent && !row.isSection && !row.isForEachSubField && !isGhost && !hasIn && !hasSeg && !hasCelExpr && !(activeInPaths?.has(row.fieldPath ?? '')) && !!row.fieldPath && !!onValueEdit;
          const isEditing  = isEditable && editingRowPath === row.fieldPath;
          // True for top-level forEach variable rows (e.g. _forEach.role, not _forEach.role.name)
          const isForEachVarRow = !!(row.fieldPath && sectionOf(row.fieldPath) === 'forEach' && !sectionRelPath(row.fieldPath).includes('.'));
          const forEachSubAddBtn = isForEachVarRow && isExpanded && !isDrawing && onAddSectionItem
            ? <Box component="span" role="button" tabIndex={-1}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setAddingForEachSubVarPath(row.fieldPath!); setSubFieldInput(''); setAddingSectionKey(null); }}
                sx={{ display: 'inline-flex', alignItems: 'center', px: 0.3, borderRadius: 0.3, cursor: 'pointer', color: userC, opacity: 0.45, flexShrink: 0, '&:hover': { opacity: 1, bgcolor: alpha(userC, 0.12) } }}>
                <Icon icon="mdi:plus" width={9} />
              </Box>
            : null;

          // Section-header rows (forEach / includeWhen / readyWhen labels)
          if (row.isSection) {
            const secKey = row.key as 'forEach' | 'includeWhen' | 'readyWhen';
            const isFE = secKey === 'forEach';
            const canAdd = isExpanded && !isDrawing && !!onAddSectionItem;
            const inputOpen = addingSectionKey === secKey;
            return (
              <Fragment key={`section-${i}`}>
                <Box sx={{
                  height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center',
                  borderTop: `2px solid ${alpha(accent, 0.25)}`, px: 1,
                  bgcolor: dark ? alpha(accent, 0.08) : alpha(accent, 0.04),
                }}>
                  <Typography variant="caption" fontWeight={700} noWrap
                    sx={{ fontFamily: 'monospace', fontSize: '0.58rem', color: accent, flex: 1 }}>
                    {row.key}
                  </Typography>
                  {canAdd && (
                    <Box component="span" role="button" tabIndex={-1}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation();
                        if (isFE) { setAddingSectionKey(inputOpen ? null : 'forEach'); setSectionVarInput(''); }
                        else { onAddSectionItem!(node.id, secKey); }
                      }}
                      sx={{ display: 'inline-flex', alignItems: 'center', px: 0.3, borderRadius: 0.3, cursor: 'pointer', color: userC, opacity: 0.5, flexShrink: 0, '&:hover': { opacity: 1, bgcolor: alpha(userC, 0.12) } }}>
                      <Icon icon="mdi:plus" width={9} />
                    </Box>
                  )}
                </Box>
                {inputOpen && (
                  <Box sx={{ height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center', borderTop: `1px dashed ${alpha(userC, 0.3)}` }}
                    onMouseDown={e => e.stopPropagation()}>
                    <input
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      placeholder="var name"
                      value={sectionVarInput}
                      style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC, paddingLeft: '18px' }}
                      onChange={e => setSectionVarInput(e.target.value)}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          const name = sectionVarInput.trim();
                          if (name) onAddSectionItem!(node.id, 'forEach', name);
                          setAddingSectionKey(null); setSectionVarInput('');
                        } else if (e.key === 'Escape') {
                          setAddingSectionKey(null); setSectionVarInput('');
                        }
                      }}
                    />
                  </Box>
                )}
              </Fragment>
            );
          }

          // Ghost rows: show as muted add-suggestion rows
          if (isGhost) {
            return (
              <Fragment key={`ghost-${i}`}>
              <Box sx={{
                height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center',
                borderTop: `1px dashed ${alpha(userC, isHov ? 0.35 : 0.12)}`,
                bgcolor: isHov
                  ? (dark ? alpha(userC, 0.25) : alpha(userC, 0.14))
                  : 'transparent',
                outline: isHov ? `1px solid ${userC}` : 'none', outlineOffset: '-1px',
                opacity: row.isParent ? 0.35 : 0.55,
                cursor: isDrawing ? 'crosshair' : (row.isParent ? 'inherit' : 'pointer'),
                '&:hover': row.isParent ? {} : { opacity: 1, bgcolor: alpha(userC, 0.06) },
              }}
              onClick={e => {
                if (!isDrawing && !row.isParent && row.fieldPath) {
                  e.stopPropagation();
                  onPotentialFieldClick(node.id, row.fieldPath);
                }
              }}
              onMouseDown={e => e.stopPropagation()}
              >
                <Box sx={{ pl: `${indent}px`, pr: 0.5, flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {row.isParent ? (
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', color: userC }}>
                      {/^\d+$/.test(row.key) ? `[${row.key}]` : `${row.key}:`}
                    </Typography>
                  ) : (
                    <>
                      <Icon icon="mdi:plus" width={9} style={{ color: userC, flexShrink: 0 }} />
                      <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', color: userC }}>{row.key}</Typography>
                      {row.ghostType && (
                        <Box component="span" sx={{
                          fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1,
                          px: 0.4, borderRadius: 0.4, flexShrink: 0,
                          border: `1px solid ${alpha(userC, 0.25)}`, color: userC, opacity: 0.5,
                        }}>
                          {abbrevType(row.ghostType)}
                        </Box>
                      )}
                    </>
                  )}
                </Box>
              </Box>
              {addInputAfterIdx === i && inlineMapInput}
              </Fragment>
            );
          }

          const isNumericParent = row.isParent && /^\d+$/.test(row.key);
          const isRowHovered = isExpanded && (!row.isParent || isNumericParent) && !!row.fieldPath && hoveredRowPath === row.fieldPath;
          const displayKey = /^\d+$/.test(row.key) ? `[${row.key}]:` : `${row.key}:`;
          return (
            <Fragment key={i}>
            <Box sx={{
              height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center',
              borderTop: i > 0 ? `1px solid ${alpha(isVirt ? userC : accent, 0.07)}` : 'none',
              bgcolor: isHov
                ? (dark ? alpha(userC, 0.25) : alpha(userC, 0.14))
                : isEdited
                ? (dark ? alpha(amberC, 0.13) : alpha(amberC, 0.08))
                : isVirt
                ? (dark ? alpha(userC, 0.07) : alpha(userC, 0.04))
                : hasIn       ? (dark ? alpha(pa, 0.08)            : alpha(pa, 0.04))
                : hasActiveIn ? (dark ? alpha(activeInInfo!.color, 0.08) : alpha(activeInInfo!.color, 0.04))
                : hasSeg     ? (dark ? alpha(accent, 0.06)  : alpha(accent, 0.03))
                : hasCelExpr ? (dark ? alpha(accent, 0.05)  : alpha(accent, 0.025))
                : hasOut     ? (dark ? alpha(accent, 0.05)  : alpha(accent, 0.025))
                : 'transparent',
              outline: isHov ? `1px solid ${userC}` : 'none', outlineOffset: '-1px',
              cursor: isDrawing ? 'crosshair' : (isEditable ? 'text' : (!row.isParent && row.fieldPath ? 'pointer' : 'inherit')),
            }}
            onMouseEnter={() => { if ((!row.isParent || isNumericParent) && row.fieldPath) setHoveredRowPath(row.fieldPath); }}
            onMouseLeave={() => setHoveredRowPath(null)}
            onClick={e => { e.stopPropagation(); if (isEditable && !isEditing) { setEditingRowPath(row.fieldPath!); setEditingValue(row.value ?? ''); } }}
            >
              <Box sx={{ pl: `${indent}px`, pr: isEdited ? 0 : 0.5, flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {row.isParent ? (
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.5, flex: 1 }}>
                      {/^\d+$/.test(row.key) ? `[${row.key}]` : `${row.key}:`}
                    </Typography>
                    {isExpanded && arrayParentPaths?.has(row.fieldPath ?? '') && (
                      <Box component="span" role="button" tabIndex={-1}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onAddArrayItem?.(node.id, row.fieldPath!); }}
                        sx={{ display: 'inline-flex', alignItems: 'center', px: 0.3, borderRadius: 0.3, cursor: 'pointer', color: userC, opacity: 0.5, flexShrink: 0, '&:hover': { opacity: 1, bgcolor: alpha(userC, 0.12) } }}
                      >
                        <Icon icon="mdi:plus" width={9} />
                      </Box>
                    )}
                    {isExpanded && !arrayParentPaths?.has(row.fieldPath ?? '') && !mapParentPaths?.has(row.fieldPath ?? '') && (node.type === 'kro-resource' || node.type === 'kro-ref' || node.type === 'schema') && (
                      <Box component="span" role="button" tabIndex={-1}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); setAddingToParentPath(row.fieldPath!); setAddFieldInput(''); setAddSuggIdx(-1); }}
                        sx={{ display: 'inline-flex', alignItems: 'center', px: 0.3, borderRadius: 0.3, cursor: 'pointer', color: userC, opacity: 0.5, flexShrink: 0, '&:hover': { opacity: 1, bgcolor: alpha(userC, 0.12) } }}
                      >
                        <Icon icon="mdi:plus" width={9} />
                      </Box>
                    )}
                    {isExpanded && mapParentPaths?.has(row.fieldPath ?? '') && (
                      <Box component="span" role="button" tabIndex={-1}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); setAddingToMap(row.fieldPath!); setAddMapKey(''); }}
                        sx={{ display: 'inline-flex', alignItems: 'center', px: 0.3, borderRadius: 0.3, cursor: 'pointer', color: userC, opacity: 0.5, flexShrink: 0, '&:hover': { opacity: 1, bgcolor: alpha(userC, 0.12) } }}
                      >
                        <Icon icon="mdi:plus" width={9} />
                      </Box>
                    )}
                  </>
                ) : hasSeg ? (
                  // Composed CEL string — render as inline token pills
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{displayKey}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, overflow: 'hidden', flexWrap: 'nowrap', minWidth: 0 }}>
                      {row.segments!.map((seg, si) => {
                        if (seg.kind === 'literal') {
                          return (
                            <Typography key={si} variant="caption" noWrap
                              sx={{ fontFamily: 'monospace', fontSize: '0.58rem', opacity: 0.55, flexShrink: 0 }}>
                              {seg.text}
                            </Typography>
                          );
                        }
                        if (seg.text === 'expr') {
                          const rawExpr = `\${${seg.srcRef}.${seg.srcPath}}`;
                          return (
                            <Tooltip key={si} title={`Invalid or unrecognized CEL: ${rawExpr}`} placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
                              <Box component="span" sx={{
                                display: 'inline-flex', alignItems: 'center', gap: 0.25,
                                fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
                                px: 0.5, py: 0.15, borderRadius: 0.5, flexShrink: 0,
                                bgcolor: alpha('#ef4444', 0.08), color: '#ef4444',
                                border: `1px solid ${alpha('#ef4444', 0.3)}`,
                              }}>
                                <Icon icon="mdi:alert-circle-outline" width={9} />
                                <Box component="span">invalid CEL</Box>
                              </Box>
                            </Tooltip>
                          );
                        }
                        const segColor = refAccent(seg.srcRef!, dark, nodeTypeByRef?.get(seg.srcRef!));
                        return (
                          <VarPill
                            key={si}
                            color={segColor}
                            label={seg.text}
                            tooltip={`${seg.srcRef}.${seg.srcPath}`}
                            onMouseEnter={() => onTokenHover({ srcNodeId: seg.srcNodeId!, srcPath: seg.srcPath!, tgtNodeId: node.id })}
                            onMouseLeave={onTokenLeave}
                          />
                        );
                      })}
                    </Box>
                  </>
                ) : hasCelExpr ? (
                  // Complex CEL expression driven by an op-node — show key label + op-node VarPill
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{displayKey}</Typography>
                    {(() => {
                      const opInfo = row.fieldPath ? opConnectedFields?.get(row.fieldPath) : undefined;
                      if (!opInfo) {
                        const rawExpr = row.celExpr ?? '';
                        return (
                          <Tooltip title={`Invalid or unrecognized CEL: ${rawExpr}`} placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
                            <Box component="span" sx={{
                              display: 'inline-flex', alignItems: 'center', gap: 0.25,
                              fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
                              px: 0.5, py: 0.15, borderRadius: 0.5, flexShrink: 0,
                              bgcolor: alpha('#ef4444', 0.08), color: '#ef4444',
                              border: `1px solid ${alpha('#ef4444', 0.3)}`,
                            }}>
                              <Icon icon="mdi:alert-circle-outline" width={9} />
                              <Box component="span">invalid CEL</Box>
                            </Box>
                          </Tooltip>
                        );
                      }
                      return (
                        <VarPill
                          color={userC}
                          label={opInfo.label}
                          tooltip={row.celExpr ? row.celExpr.replace(/^\$\{([\s\S]*)\}$/, '$1') : undefined}
                          typeSuffix={opInfo.type ? abbrevType(opInfo.type) : undefined}
                          onMouseEnter={() => onTokenHover({ srcNodeId: opInfo.srcNodeId, srcPath: 'output', tgtNodeId: node.id })}
                          onMouseLeave={onTokenLeave}
                        />
                      );
                    })()}
                  </>
                ) : hasIn ? (
                  // Pure single-ref CEL (inPort) — render as a source-field pill
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{displayKey}</Typography>
                    <VarPill
                      color={pa}
                      label={row.inPort!.srcShort}
                      tooltip={row.inPort!.srcPath ? `${row.inPort!.origRef ?? row.inPort!.ref}.${row.inPort!.srcPath}` : (row.inPort!.origRef ?? row.inPort!.srcShort)}
                      optional={row.inPort!.optional}
                      typeSuffix={isForEachVarRow ? '[]' : undefined}
                      onToggleOptional={e => { e.stopPropagation(); onToggleInPortOptional?.(node.id, row.fieldPath!); }}
                      onMouseEnter={() => onTokenHover({ srcNodeId: refToNodeId(row.inPort!.ref), srcPath: row.inPort!.srcPath, tgtNodeId: node.id })}
                      onMouseLeave={onTokenLeave}
                    />
                    {forEachSubAddBtn}
                  </>
                ) : hasActiveIn ? (
                  // Unsaved ExtraEdge connection — render as a pending VarPill
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{displayKey}</Typography>
                    {(() => {
                      const opInfo = row.fieldPath ? opConnectedFields?.get(row.fieldPath) : undefined;
                      if (opInfo) {
                        return (
                          <VarPill
                            color={userC}
                            label={opInfo.label}
                            typeSuffix={opInfo.type ? abbrevType(opInfo.type) : undefined}
                            onMouseEnter={() => onTokenHover({ srcNodeId: opInfo.srcNodeId, srcPath: 'output', tgtNodeId: node.id })}
                            onMouseLeave={onTokenLeave}
                          />
                        );
                      }
                      return (
                        <VarPill
                          color={activeInInfo!.color}
                          label={activeInInfo!.label}
                          tooltip={activeInInfo!.srcFieldPath.replace(/\?/g, '')}
                          onMouseEnter={() => onTokenHover({ srcNodeId: activeInInfo!.srcNodeId, srcPath: activeInInfo!.srcFieldPath.replace(/\?/g, ''), tgtNodeId: node.id })}
                          onMouseLeave={onTokenLeave}
                        />
                      );
                    })()}
                  </>
                ) : (hasOut || isVirt) ? (
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0, ...(isVirt && { color: userC }) }}>{displayKey}</Typography>
                    {isEditing
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      ? <input autoFocus value={editingValue}
                          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC }}
                          onChange={e => setEditingValue(e.target.value)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitValueEdit(row.fieldPath!, editingValue); else if (e.key === 'Escape') { setEditingRowPath(null); setEditingValue(''); } }}
                          onBlur={() => commitValueEdit(row.fieldPath!, editingValue)}
                          onMouseDown={e => e.stopPropagation()}
                        />
                      : row.value !== undefined
                        ? <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.58rem', opacity: 0.75 }}>{row.value}</Typography>
                        : row.ghostType
                          ? <Box component="span" sx={{
                              fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1,
                              px: 0.4, borderRadius: 0.4, flexShrink: 0,
                              border: `1px solid ${alpha(isVirt ? userC : accent, 0.25)}`,
                              color: isVirt ? userC : accent, opacity: 0.55,
                            }}>
                              {abbrevType(row.ghostType)}
                            </Box>
                          : null
                    }
                    {forEachSubAddBtn}
                  </>
                ) : (
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.5, flexShrink: 0 }}>{displayKey}</Typography>
                    {isEditing
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      ? <input autoFocus value={editingValue}
                          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC }}
                          onChange={e => setEditingValue(e.target.value)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitValueEdit(row.fieldPath!, editingValue); else if (e.key === 'Escape') { setEditingRowPath(null); setEditingValue(''); } }}
                          onBlur={() => commitValueEdit(row.fieldPath!, editingValue)}
                          onMouseDown={e => e.stopPropagation()}
                        />
                      : row.value !== undefined
                        ? <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.58rem', opacity: 0.75 }}>{row.value}</Typography>
                        : null
                    }
                  </>
                )}
              </Box>
              {isEdited && (
                <Icon icon="mdi:pencil" width={9} style={{ color: amberC, opacity: 0.5, flexShrink: 0, marginRight: isRowHovered ? 0 : 4 }} />
              )}
              {!row.isParent && !row.isGhost && row.fieldPath && unknownFieldPaths?.has(row.fieldPath) && (
                <Tooltip title="Field not found in schema" placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
                  <span style={{ display: 'inline-flex', flexShrink: 0, marginRight: isRowHovered ? 0 : 4 }}>
                    <Icon icon="mdi:alert-circle-outline" width={10} style={{ color: '#f59e0b' }} />
                  </span>
                </Tooltip>
              )}
              {isRowHovered && onDeleteRow && (
                <Box component="span" role="button" tabIndex={-1}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onDeleteRow(node.id, row.fieldPath!); }}
                  sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 14, height: 14, borderRadius: 0.3, flexShrink: 0, mr: 0.5, cursor: 'pointer',
                    color: alpha('#ef4444', 0.5),
                    '&:hover': { color: '#ef4444', bgcolor: alpha('#ef4444', 0.1) },
                  }}>
                  <Icon icon="mdi:close" width={10} />
                </Box>
              )}
            </Box>
            {addInputAfterIdx === i && inlineMapInput}
            {addParentInputAfterIdx === i && inlinePickerInput}
            {addForEachSubAfterIdx === i && inlineForEachSubInput}
            </Fragment>
          );
          });
          return (
            <>
              {addingToParentPath === '' && inlinePickerInput}
              {rows}
            </>
          );
        })()}

      </Paper>

      {/* Inline field picker dropdown — rendered outside Paper so it can overflow the node boundary */}
      {addingToParentPath !== null && !isFreeFormInline && filteredInlineOptions.length > 0 && (
        <Paper elevation={8} sx={{
          position: 'absolute',
          top: addingToParentPath === ''
            ? HEADER_H + (showSectionAdd ? ROW_H : 0) + ROW_H
            : HEADER_H + (showSectionAdd ? ROW_H : 0) + (addParentInputAfterIdx + 2) * ROW_H,
          left: 0, right: 0, zIndex: 30,
          maxHeight: 160, overflowY: 'auto',
          borderRadius: '0 0 6px 6px',
          border: `1px solid ${alpha(userC, 0.35)}`,
          borderTop: 'none',
        }}
          onMouseDown={e => e.stopPropagation()}
        >
          {filteredInlineOptions.map((s, si) => {
            const pfx = addingToParentPath ? `${addingToParentPath}.` : '';
            const relKey = s.path.slice(pfx.length);
            return (
              <Box key={s.path}
                onMouseDown={e => { e.preventDefault(); commitInlineAdd(relKey); }}
                onMouseEnter={() => setAddSuggIdx(si)}
                sx={{
                  px: 1.5, py: 0.3, cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 0.75,
                  bgcolor: si === addSuggIdx ? alpha(userC, 0.14) : 'transparent',
                  '&:hover': { bgcolor: alpha(userC, 0.08) },
                  borderBottom: `1px solid ${alpha(userC, 0.06)}`,
                }}
              >
                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.6rem' }}>{relKey}</Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.54rem', opacity: 0.4, ml: 'auto', flexShrink: 0 }}>{s.type}</Typography>
              </Box>
            );
          })}
        </Paper>
      )}
    </div>
  );
});


// ── DraftNodeCard ──────────────────────────────────────────────────────────────

export interface DraftNodeCardProps {
  node: GNode;
  /** Screen-space left offset within the container (canvas coords × scale + pan.x). */
  screenLeft: number;
  /** Screen-space top offset within the container (canvas coords × scale + pan.y). */
  screenTop: number;
  dark: boolean;
  addForm: AddForm;
  kindOptions: KindOption[];
  existingIds: Set<string>;
  onFormChange: (f: AddForm) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onMouseDown: (e: MouseEvent, id: string) => void;
}

export function DraftNodeCard({ node, screenLeft, screenTop, dark, addForm, kindOptions, existingIds, onFormChange, onConfirm, onCancel, onMouseDown }: DraftNodeCardProps) {
  const targetType = addForm.mode === 'externalRef' ? 'kro-ref' : 'kro-resource';
  const cfg        = NODE_CFG[targetType];
  const accent     = dark ? cfg.accentDark : cfg.accent;
  const idInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { idInputRef.current?.focus({ preventScroll: true }); }, []);
  const idTrimmed = addForm.id.trim();
  const hasDuplicateId = !!idTrimmed && existingIds.has(idTrimmed);
  const canConfirm = !!idTrimmed && !!addForm.kind && !!addForm.apiVersion && !hasDuplicateId &&
    (addForm.mode !== 'externalRef' || addForm.refLookup !== 'selector' || addForm.refLabels.some(l => l.key.trim()));

  return (
    <div
      role="button" tabIndex={0}
      style={{ position: 'absolute', left: screenLeft, top: screenTop, width: node.w, cursor: 'grab', zIndex: 2 }}
      onMouseDown={e => { e.stopPropagation(); onMouseDown(e, node.id); }}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && canConfirm) onConfirm(); if (e.key === 'Escape') onCancel(); }}
    >
      <Paper elevation={4} sx={{
        width: '100%',
        border: `2px dashed ${alpha(accent, 0.8)}`,
        borderRadius: 1.5, overflow: 'visible',
        display: 'flex', flexDirection: 'column',
        background: dark
          ? `repeating-linear-gradient(-45deg, transparent 0px, transparent 6px, ${alpha(accent, 0.07)} 6px, ${alpha(accent, 0.07)} 12px), linear-gradient(140deg, ${alpha(accent, 0.22)} 0%, #1c1c1c 100%)`
          : `repeating-linear-gradient(-45deg, transparent 0px, transparent 6px, ${alpha(accent, 0.06)} 6px, ${alpha(accent, 0.06)} 12px), linear-gradient(140deg, ${alpha(accent, 0.07)} 0%, #fff 100%)`,
      }}>
        {/* Header */}
        <Box sx={{
          px: 1.5, height: HEADER_H, flexShrink: 0,
          background: dark ? alpha(accent, 0.28) : alpha(accent, 0.1),
          borderBottom: `1px solid ${alpha(accent, 0.2)}`,
          display: 'flex', alignItems: 'center', gap: 0.75,
        }}>
          <Icon icon={cfg.icon} width={14} style={{ color: accent, flexShrink: 0 }} />
          <Typography variant="caption" fontWeight={700} noWrap
            sx={{ color: accent, fontSize: '0.72rem', lineHeight: 1, flex: 1 }}>
            Add resource
          </Typography>
          <Box component="span" role="button" tabIndex={-1}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onCancel(); }}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: 0.5, flexShrink: 0,
              color: alpha(accent, 0.6), cursor: 'pointer',
              '&:hover': { color: '#ef4444', bgcolor: alpha('#ef4444', 0.12) },
            }}>
            <Icon icon="mdi:close" width={12} />
          </Box>
        </Box>

        {/* Form body */}
        <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <SegmentedControl
            options={[{ value: 'template', label: 'New resource' }, { value: 'externalRef', label: 'External ref' }] as const}
            value={addForm.mode}
            onChange={m => onFormChange({ ...addForm, mode: m })}
          />
          <TextField
            label="id" size="small"
            inputRef={idInputRef}
            value={addForm.id}
            onChange={e => onFormChange({ ...addForm, id: e.target.value })}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && canConfirm) onConfirm(); if (e.key === 'Escape') onCancel(); }}
            error={hasDuplicateId}
            helperText={hasDuplicateId ? 'ID already exists' : undefined}
            inputProps={{ style: { fontSize: '0.78rem' } }}
            sx={{ '& .MuiInputLabel-root': { fontSize: '0.78rem' }, '& .MuiFormHelperText-root': { fontSize: '0.65rem' } }}
          />
          <Autocomplete
            options={kindOptions}
            getOptionLabel={opt => opt.kind}
            isOptionEqualToValue={(a, b) => a.kind === b.kind && a.apiVersion === b.apiVersion}
            value={addForm.kind && addForm.apiVersion ? { kind: addForm.kind, apiVersion: addForm.apiVersion } : null}
            onChange={(_, opt) => onFormChange({ ...addForm, kind: opt?.kind ?? '', apiVersion: opt?.apiVersion ?? '' })}
            renderOption={(props, opt) => (
              <li {...props} key={`${opt.apiVersion}/${opt.kind}`}>
                <Box>
                  <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>{opt.kind}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.55, fontSize: '0.68rem' }}>{opt.apiVersion}</Typography>
                </Box>
              </li>
            )}
            renderInput={params => (
              <TextField {...params} label="kind" size="small"
                inputProps={{ ...params.inputProps, style: { fontSize: '0.78rem' } }}
                sx={{ '& .MuiInputLabel-root': { fontSize: '0.78rem' } }}
              />
            )}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onCancel(); }}
            size="small"
          />

          {addForm.mode === 'externalRef' && (
            <>
              <SegmentedControl
                options={[{ value: 'name', label: 'By name' }, { value: 'selector', label: 'By selector' }] as const}
                value={addForm.refLookup}
                onChange={m => onFormChange({ ...addForm, refLookup: m })}
                py={0.3}
              />
              {addForm.refLookup === 'name' ? (
                <TextField
                  label="name" size="small"
                  value={addForm.refName}
                  onChange={e => onFormChange({ ...addForm, refName: e.target.value })}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && canConfirm) onConfirm(); if (e.key === 'Escape') onCancel(); }}
                  inputProps={{ style: { fontSize: '0.78rem' } }}
                  sx={{ '& .MuiInputLabel-root': { fontSize: '0.78rem' } }}
                />
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem' }}>Match labels</Typography>
                  {addForm.refLabels.map((lbl, li) => (
                    <Box key={li} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <input
                        placeholder="key"
                        value={lbl.key}
                        onChange={e => onFormChange({ ...addForm, refLabels: addForm.refLabels.map((l, i) => i === li ? { ...l, key: e.target.value } : l) })}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.72rem', padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4, background: 'transparent', color: 'inherit' }}
                      />
                      <Typography variant="caption" sx={{ opacity: 0.4, flexShrink: 0 }}>=</Typography>
                      <input
                        placeholder="value"
                        value={lbl.value}
                        onChange={e => onFormChange({ ...addForm, refLabels: addForm.refLabels.map((l, i) => i === li ? { ...l, value: e.target.value } : l) })}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.72rem', padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4, background: 'transparent', color: 'inherit' }}
                      />
                      <IconButton size="small" sx={{ p: 0.25, flexShrink: 0 }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={() => onFormChange({ ...addForm, refLabels: addForm.refLabels.filter((_, i) => i !== li) })}>
                        <Icon icon="mdi:close" width={12} />
                      </IconButton>
                    </Box>
                  ))}
                  <Button size="small" startIcon={<Icon icon="mdi:plus" width={12} />}
                    sx={{ fontSize: '0.65rem', alignSelf: 'flex-start', px: 0.75, py: 0.25 }}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => onFormChange({ ...addForm, refLabels: [...addForm.refLabels, { key: '', value: '' }] })}
                  >
                    Add label
                  </Button>
                </Box>
              )}
            </>
          )}

          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end', pt: 0.25 }}>
            <Button size="small" onMouseDown={e => e.stopPropagation()} onClick={onCancel}>Cancel</Button>
            <Button size="small" variant="contained" disableElevation disabled={!canConfirm}
              onMouseDown={e => e.stopPropagation()} onClick={onConfirm}>
              Add
            </Button>
          </Box>
        </Box>
      </Paper>
    </div>
  );
}
