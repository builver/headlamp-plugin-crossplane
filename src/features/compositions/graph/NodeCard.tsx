import { Icon } from '@iconify/react';
import { Autocomplete, Box, Button, IconButton, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CSSProperties, Fragment, memo, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { reconstructTemplate } from './celUtils';
import { DOT, HEADER_H, NODE_CFG, NODE_MIN_H, refAccent, refToNodeId,ROW_H, USER_C_DARK, USER_C_LIGHT } from './constants';

function normalizePath(p: string) { return p.trim().replace(/\[(\d+)\]/g, '.$1'); }
import { AddForm, FieldSuggestion, GNode, KindOption, NodeType, TokenHover, TRow } from './types';

// ── SegmentedControl ──────────────────────────────────────────────────────────

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  py?: number;
}

export function SegmentedControl<T extends string>({ options, value, onChange, py = 0.4 }: SegmentedControlProps<T>) {
  return (
    <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      {options.map((opt, i) => (
        <Box key={opt.value} onClick={() => onChange(opt.value)}
          sx={{
            flex: 1, textAlign: 'center', py, cursor: 'pointer', fontSize: '0.67rem',
            fontWeight: value === opt.value ? 700 : 400,
            bgcolor: value === opt.value ? 'action.selected' : 'transparent',
            color: value === opt.value ? 'text.primary' : 'text.secondary',
            '&:hover': { bgcolor: value === opt.value ? 'action.selected' : 'action.hover' },
            transition: 'background-color 0.15s',
            ...(i < options.length - 1 ? { borderRight: '1px solid', borderColor: 'divider' } : {}),
          }}
        >
          {opt.label}
        </Box>
      ))}
    </Box>
  );
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

export interface NodeCardProps {
  node: GNode;
  selected: boolean;
  dark: boolean;
  isDrawing: boolean;
  /** rowIdx >= node.rows.length → potential field row highlighted during edge drag. */
  hoverRowIdx?: number;
  /** Set when a CEL token is being hovered anywhere in the graph — highlights this node if it's the source. */
  tokenHover?: TokenHover | null;
  onMouseDown: (e: MouseEvent, id: string) => void;
  onClick: (id: string) => void;
  onPortDown: (e: MouseEvent, nodeId: string, fieldPath: string) => void;
  /** Schema fields not yet present on this node. Used for autocomplete (and ghost rows during edge drag). */
  potentialFields: FieldSuggestion[];
  /** True when the node is selected OR is the current edge-drag hover target. */
  isExpanded: boolean;
  onPotentialFieldClick: (nodeId: string, fieldPath: string) => void;
  onTokenHover: (th: TokenHover) => void;
  onTokenLeave: () => void;
  onRowClick: (nodeId: string, fieldPath: string, currentTemplate: string) => void;
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
}

export const NodeCard = memo(function NodeCard({
  node, selected, dark, isDrawing, hoverRowIdx, tokenHover,
  onMouseDown, onClick, onPortDown, potentialFields, isExpanded,
  onPotentialFieldClick, onTokenHover, onTokenLeave, onRowClick, editedPaths, onDelete, onDeleteRow, mapParentPaths, arrayParentPaths, onAddArrayItem, nodeTypeByRef,
}: NodeCardProps) {
  const cfg   = NODE_CFG[node.type];
  const accent = dark ? cfg.accentDark : cfg.accent;
  const userC  = dark ? USER_C_DARK : USER_C_LIGHT;
  const [hovered,        setHovered]        = useState(false);
  const [showAddField,   setShowAddField]   = useState(false);
  const [addFieldInput,  setAddFieldInput]  = useState('');
  const [addSuggIdx,     setAddSuggIdx]     = useState(-1);
  const [addingToMap,    setAddingToMap]    = useState<string | null>(null);
  const [addMapKey,      setAddMapKey]      = useState('');
  const [hoveredRowPath, setHoveredRowPath] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded && node.type !== 'env') { setShowAddField(false); setAddFieldInput(''); setAddSuggIdx(-1); setAddingToMap(null); setAddMapKey(''); }
  }, [isExpanded, node.type]); // node.type is stable per instance; listed to satisfy exhaustive-deps

  // Filtered suggestions for the resource/ref autocomplete add-field input
  const filteredSuggs = useMemo(() => {
    if (!showAddField || node.type === 'env') return [];
    const q = normalizePath(addFieldInput).toLowerCase();
    if (!q) return potentialFields.slice(0, 50);
    return potentialFields.filter(s => s.path.toLowerCase().includes(q)).slice(0, 50);
  }, [showAddField, addFieldInput, potentialFields, node.type]);

  useEffect(() => { setAddSuggIdx(-1); }, [filteredSuggs]);

  const commitAdd = (rawPath: string) => {
    const path = normalizePath(rawPath);
    if (path) onPotentialFieldClick(node.id, path);
    setShowAddField(false); setAddFieldInput(''); setAddSuggIdx(-1);
  };

  const showPotentialDots = hovered || isDrawing;
  const displayRows = node.rows;
  // env: free-form add always; resource/ref: schema-autocomplete add when expanded (not during edge draw)
  const showAddButton = node.type === 'env' || (isExpanded && !isDrawing && (node.type === 'kro-resource' || node.type === 'kro-ref'));
  const displayH          = (displayRows.length === 0 ? NODE_MIN_H : HEADER_H + displayRows.length * ROW_H + 8) + (showAddButton ? ROW_H : 0);
  const isTokenSource     = !!tokenHover && tokenHover.srcNodeId === node.id;

  // Index in displayRows after which to render the inline map-key input row.
  const addInputAfterIdx = useMemo(() => {
    if (!addingToMap) return -1;
    const parentIdx = displayRows.findIndex(r => r.fieldPath === addingToMap && r.isParent);
    if (parentIdx < 0) return displayRows.length - 1;
    const parentDepth = displayRows[parentIdx].depth;
    let last = parentIdx;
    for (let i = parentIdx + 1; i < displayRows.length; i++) {
      if (displayRows[i].depth > parentDepth) last = i;
      else break;
    }
    return last;
  }, [addingToMap, displayRows]);

  const dotSx = (color: string, right: boolean, topOff: number, extra?: CSSProperties): CSSProperties => ({
    position: 'absolute',
    ...(right ? { right: -DOT / 2 } : { left: -DOT / 2 }),
    top: topOff, width: DOT, height: DOT, borderRadius: '50%',
    background: color, border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`, zIndex: 3,
    ...extra,
  });

  return (
    <div
      role="button" tabIndex={0}
      style={{ position: 'absolute', left: node.x, top: node.y, width: node.w, height: displayH,
        cursor: isDrawing ? 'crosshair' : 'grab', zIndex: 2 }}
      onMouseDown={e => { e.stopPropagation(); onMouseDown(e, node.id); }}
      onClick={e => { e.stopPropagation(); onClick(node.id); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(node.id); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Port circles for rows */}
      {/* Port dots — unified over displayRows (includes ghost rows in their merged position) */}
      {displayRows.map((row, i) => {
        const top = HEADER_H + i * ROW_H + ROW_H / 2 - DOT / 2;
        const leftDot = row.inPort
          ? <div key={`in-${i}`} style={dotSx(refAccent(row.inPort.ref, dark), false, top)} />
          : null;
        const isConf  = !!row.outPort;
        const isGhost = !!row.isGhost;
        const isPot   = !row.isParent && !isConf && !!row.fieldPath;
        const virtC   = row.isVirtual ? userC : (dark ? '#555' : '#bbb');
        const showR   = isConf || ((isPot || row.isVirtual) && showPotentialDots && !isGhost);
        const rightDot = showR ? (
          <div key={`out-${i}`} role="button" tabIndex={-1}
            style={dotSx(isConf ? accent : virtC, true, top, { opacity: (!isConf && !row.isVirtual) ? 0.4 : 1, cursor: 'crosshair' })}
            onMouseDown={e => { e.stopPropagation(); onPortDown(e, node.id, row.fieldPath!); }}
          />
        ) : null;
        return <Fragment key={i}>{leftDot}{rightDot}</Fragment>;
      })}

      {displayRows.length === 0 && (
        <div style={dotSx(accent, true, node.h / 2 - DOT / 2)} />
      )}

      <Paper elevation={selected ? 8 : 2} sx={{
        width: '100%', height: displayH,
        border: `2px solid ${isTokenSource ? accent : selected ? accent : alpha(accent, 0.55)}`,
        borderRadius: 1.5, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        background: dark
          ? `linear-gradient(140deg, ${alpha(accent, 0.22)} 0%, #1c1c1c 100%)`
          : `linear-gradient(140deg, ${alpha(accent, 0.07)} 0%, #fff 100%)`,
        boxShadow: isTokenSource
          ? `0 0 0 3px ${alpha(accent, 0.5)}, 0 0 16px 2px ${alpha(accent, 0.35)}`
          : selected ? `0 0 0 3px ${alpha(accent, 0.35)}` : undefined,
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
        </Box>

        {/* Rows — unified render of displayRows (includes ghost rows at correct hierarchy positions) */}
        {(() => {
          const mapParentDepth = displayRows.find(r => r.fieldPath === addingToMap && r.isParent)?.depth ?? 0;
          const mapInputIndent = 8 + (mapParentDepth + 1) * 10;
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

          return displayRows.map((row: TRow, i: number) => {
          const indent     = 8 + row.depth * 10;
          const hasIn      = !!row.inPort;
          const hasOut     = !!row.outPort;
          const hasSeg     = !!row.segments?.length;
          const hasCelExpr = !!row.celExpr;
          const pa         = hasIn ? refAccent(row.inPort!.ref, dark, nodeTypeByRef?.get(row.inPort!.ref)) : accent;
          const isVirt     = !!row.isVirtual;
          const isGhost    = !!row.isGhost;
          const isHov      = i === hoverRowIdx && !row.isParent;
          const isEdited   = !row.isParent && !!row.fieldPath && editedPaths.has(node.id + '::' + row.fieldPath);
          const amberC     = dark ? '#ffd54f' : '#f57f17';

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
                        <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.56rem', opacity: 0.45, color: userC }}>{row.ghostType}</Typography>
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
                : hasIn      ? (dark ? alpha(pa, 0.08)      : alpha(pa, 0.04))
                : hasSeg     ? (dark ? alpha(accent, 0.06)  : alpha(accent, 0.03))
                : hasCelExpr ? (dark ? alpha(accent, 0.05)  : alpha(accent, 0.025))
                : hasOut     ? (dark ? alpha(accent, 0.05)  : alpha(accent, 0.025))
                : 'transparent',
              outline: isHov ? `1px solid ${userC}` : 'none', outlineOffset: '-1px',
              cursor: isDrawing ? 'crosshair' : (!row.isParent && row.fieldPath ? 'pointer' : 'inherit'),
            }}
            onMouseEnter={() => { if ((!row.isParent || isNumericParent) && row.fieldPath) setHoveredRowPath(row.fieldPath); }}
            onMouseLeave={() => setHoveredRowPath(null)}
            onClick={e => {
              if (!isDrawing && !row.isParent && row.fieldPath) {
                e.stopPropagation();
                const tmpl = row.inPort
                  ? `\${${row.inPort.ref}.${row.inPort.srcPath}}`
                  : row.segments ? reconstructTemplate(row.segments)
                  : row.celExpr ?? row.value ?? '';
                onRowClick(node.id, row.fieldPath, tmpl);
              }
            }}
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
                    {isExpanded && !arrayParentPaths?.has(row.fieldPath ?? '') && !mapParentPaths?.has(row.fieldPath ?? '') && (node.type === 'kro-resource' || node.type === 'kro-ref') && (
                      <Box component="span" role="button" tabIndex={-1}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); setShowAddField(true); setAddFieldInput((row.fieldPath ?? '') + '.'); setAddSuggIdx(-1); }}
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
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{row.key}:</Typography>
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
                        const segColor = refAccent(seg.srcRef!, dark, nodeTypeByRef?.get(seg.srcRef!));
                        const isHoveredSeg = tokenHover?.srcNodeId === seg.srcNodeId && tokenHover?.srcPath === seg.srcPath;
                        return (
                          <Tooltip key={si} title={`${seg.srcRef}.${seg.srcPath}`} placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
                            <Box
                              component="span"
                              onMouseEnter={() => onTokenHover({ srcNodeId: seg.srcNodeId!, srcPath: seg.srcPath!, tgtNodeId: node.id })}
                              onMouseLeave={onTokenLeave}
                              sx={{
                                display: 'inline-flex', alignItems: 'center',
                                fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
                                px: 0.5, py: 0.15, borderRadius: 0.5,
                                bgcolor: isHoveredSeg ? alpha(segColor, 0.3) : alpha(segColor, 0.12),
                                color: segColor,
                                border: `1px solid ${alpha(segColor, isHoveredSeg ? 0.7 : 0.3)}`,
                                cursor: 'default', flexShrink: 0,
                                transition: 'background-color 0.1s, border-color 0.1s',
                                fontWeight: isHoveredSeg ? 700 : 400,
                              }}>
                              {seg.text}
                            </Box>
                          </Tooltip>
                        );
                      })}
                    </Box>
                  </>
                ) : hasCelExpr ? (
                  // Complex / multiline CEL expression — show badge with tooltip
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{row.key}:</Typography>
                    <Tooltip
                      placement="top"
                      title={<pre style={{ margin: 0, fontSize: '0.65rem', whiteSpace: 'pre-wrap', maxWidth: 320, fontFamily: 'monospace' }}>{row.celExpr}</pre>}
                      PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}
                    >
                      <Box component="span" sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.25,
                        fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
                        px: 0.5, py: 0.15, borderRadius: 0.5,
                        bgcolor: alpha(accent, 0.12), color: accent,
                        border: `1px solid ${alpha(accent, 0.3)}`,
                        cursor: 'default', flexShrink: 0,
                      }}>
                        <Icon icon="mdi:function-variant" width={9} />
                        CEL
                      </Box>
                    </Tooltip>
                  </>
                ) : hasIn ? (
                  // Pure single-ref CEL (inPort) — render as a source-field pill
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0 }}>{row.key}:</Typography>
                    <Tooltip title={`${row.inPort!.ref}.${row.inPort!.srcPath}`} placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
                      <Box
                        component="span"
                        onMouseEnter={() => onTokenHover({ srcNodeId: refToNodeId(row.inPort!.ref), srcPath: row.inPort!.srcPath, tgtNodeId: node.id })}
                        onMouseLeave={onTokenLeave}
                        sx={{
                          display: 'inline-flex', alignItems: 'center',
                          fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
                          px: 0.5, py: 0.15, borderRadius: 0.5,
                          bgcolor: tokenHover?.srcNodeId === refToNodeId(row.inPort!.ref) && tokenHover?.srcPath === row.inPort!.srcPath ? alpha(pa, 0.3) : alpha(pa, 0.12),
                          color: pa,
                          border: `1px solid ${alpha(pa, tokenHover?.srcNodeId === refToNodeId(row.inPort!.ref) && tokenHover?.srcPath === row.inPort!.srcPath ? 0.7 : 0.3)}`,
                          cursor: 'default', flexShrink: 0,
                          transition: 'background-color 0.1s, border-color 0.1s',
                          fontWeight: tokenHover?.srcNodeId === refToNodeId(row.inPort!.ref) && tokenHover?.srcPath === row.inPort!.srcPath ? 700 : 400,
                        }}>
                        {row.inPort!.srcShort}
                      </Box>
                    </Tooltip>
                  </>
                ) : (hasOut || isVirt) ? (
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.75, flexShrink: 0, ...(isVirt && { color: userC }) }}>{row.key}:</Typography>
                    {row.value !== undefined
                      ? <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.58rem', opacity: 0.75 }}>{row.value}</Typography>
                      : <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.58rem', color: isVirt ? userC : accent, opacity: 0.55 }}>{row.ghostType ?? 'string'}</Typography>
                    }
                  </>
                ) : (
                  <>
                    <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.6rem', opacity: 0.5, flexShrink: 0 }}>{row.key}:</Typography>
                    {row.value !== undefined && (
                      <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.58rem', opacity: 0.75 }}>{row.value}</Typography>
                    )}
                  </>
                )}
              </Box>
              {isEdited && (
                <Icon icon="mdi:pencil" width={9} style={{ color: amberC, opacity: 0.5, flexShrink: 0, marginRight: isRowHovered ? 0 : 4 }} />
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
            </Fragment>
          );
        });
        })()}

        {showAddButton && (
          <Box
            role="button" tabIndex={-1}
            sx={{
              height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center',
              borderTop: `1px dashed ${alpha(userC, showAddField ? 0.35 : 0.18)}`,
              px: 1, gap: 0.5,
              bgcolor: showAddField ? (dark ? alpha(userC, 0.1) : alpha(userC, 0.06)) : 'transparent',
              cursor: showAddField ? 'text' : 'pointer',
              '&:hover': showAddField ? {} : { bgcolor: dark ? alpha(userC, 0.07) : alpha(userC, 0.04) },
            }}
            onClick={e => { e.stopPropagation(); if (!showAddField) setShowAddField(true); }}
            onMouseDown={e => e.stopPropagation()}
          >
            {showAddField && node.type === 'env' ? (
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={addFieldInput}
                placeholder="e.g. data.myKey"
                onChange={e => setAddFieldInput(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') { commitAdd(addFieldInput); }
                  else if (e.key === 'Escape') { setShowAddField(false); setAddFieldInput(''); }
                }}
                onBlur={() => { setShowAddField(false); setAddFieldInput(''); }}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC }}
              />
            ) : showAddField ? (
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={addFieldInput}
                placeholder="type a field path…"
                onChange={e => { setAddFieldInput(e.target.value); setAddSuggIdx(-1); }}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAddSuggIdx(i => Math.min(i + 1, filteredSuggs.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setAddSuggIdx(i => Math.max(i - 1, -1)); }
                  else if (e.key === 'Enter') {
                    if (addSuggIdx >= 0 && filteredSuggs[addSuggIdx]) commitAdd(filteredSuggs[addSuggIdx].path);
                    else commitAdd(addFieldInput);
                  }
                  else if (e.key === 'Escape') { setShowAddField(false); setAddFieldInput(''); setAddSuggIdx(-1); }
                }}
                onBlur={() => { setTimeout(() => { setShowAddField(false); setAddFieldInput(''); setAddSuggIdx(-1); }, 150); }}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'monospace', fontSize: '0.6rem', color: userC, caretColor: userC }}
              />
            ) : (
              <>
                <Icon icon="mdi:plus" width={9} style={{ color: userC, flexShrink: 0 }}/>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.6rem', color: userC, opacity: 0.55 }}>Add field…</Typography>
              </>
            )}
          </Box>
        )}

      </Paper>

      {/* Autocomplete dropdown — rendered outside Paper so it can overflow the node boundary */}
      {showAddField && (node.type === 'kro-resource' || node.type === 'kro-ref') && filteredSuggs.length > 0 && (
        <Paper elevation={8} sx={{
          position: 'absolute', top: displayH - 1, left: 0, right: 0, zIndex: 30,
          maxHeight: 180, overflowY: 'auto',
          borderRadius: '0 0 6px 6px',
          border: `1px solid ${alpha(userC, 0.35)}`,
          borderTop: 'none',
        }}
          onMouseDown={e => e.stopPropagation()}
        >
          {filteredSuggs.map((s, si) => (
            <Box key={s.path}
              onMouseDown={e => { e.preventDefault(); commitAdd(s.path); }}
              onMouseEnter={() => setAddSuggIdx(si)}
              sx={{
                px: 1.5, py: 0.3, cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 0.75,
                bgcolor: si === addSuggIdx ? alpha(userC, 0.14) : 'transparent',
                '&:hover': { bgcolor: alpha(userC, 0.08) },
                borderBottom: `1px solid ${alpha(userC, 0.06)}`,
              }}
            >
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.6rem' }}>{s.path}</Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.54rem', opacity: 0.4, ml: 'auto', flexShrink: 0 }}>{s.type}</Typography>
            </Box>
          ))}
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
