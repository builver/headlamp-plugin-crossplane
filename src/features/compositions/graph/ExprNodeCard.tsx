import { Icon } from '@iconify/react';
import { Box, Paper, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { memo, MouseEvent } from 'react';
import { buildVarFieldRows, EXPR_NODE_HDR_H, EXPR_NODE_PORT_H, EXPR_NODE_W, exprNodeH, nodeIdToRef, PORT_DOT_SIZE, RAW_TEMPLATE_NODE_H, refAccent, varFieldLeafRow } from './constants';
import { EXPR_NODE_DEFS } from './exprGraph/exprNodeDefs';
import { NodeCardDeleteButton, NodeCardShell } from './NodeCardShell';
import { PortDot } from './PortDot';
import { ExprNode, NodeType, TokenHover } from './types';
import { abbrevType } from './typeUtils';
import { VarPill } from './VarPill';

export interface ConnectedPortInfo {
  /** Short display label (last segment of the source field path, or op category label). */
  label: string;
  /** Graph node id of the source — for token-hover highlighting. */
  srcNodeId: string;
  /** Field path within the source node — for token-hover highlighting. */
  srcFieldPath: string;
  /** Output/field type, e.g. 'string', 'boolean', 'integer'. */
  type?: string;
  /** True if the source field uses optional chaining (`.?segment`). */
  optional?: boolean;
  /** Human-readable path shown in the tooltip (overrides srcFieldPath for display). */
  displayPath?: string;
  /** Node type of the source node — used to derive the correct accent color. */
  srcNodeType: NodeType;
}

export interface ExprNodeCardProps {
  node: ExprNode;
  dark: boolean;
  userC: string;
  isDrawing: boolean;
  /** True if this op node has not yet been saved to the composition. */
  dirty?: boolean;
  /** Maps port name → source info for ports that have an incoming edge. */
  connectedPortInfo: Map<string, ConnectedPortInfo>;
  onNodeDown: (e: MouseEvent, id: string) => void;
  onOutputPortDown: (e: MouseEvent, id: string) => void;
  onInputPortUp: (e: MouseEvent, id: string, portName: string) => void;
  onInputPortClick?: (id: string, portName: string) => void;
  /** True when the op node's output port has at least one outgoing ExtraEdge. */
  hasOutputConnection?: boolean;
  onExprChange: (id: string, op: string) => void;
  onLiteralChange: (id: string, portName: string, value: string) => void;
  onResizeStart?: (e: MouseEvent, id: string) => void;
  onDelete: (id: string) => void;
  onTogglePortOptional?: (exprNodeId: string, portName: string) => void;
  onTokenHover: (th: TokenHover) => void;
  onTokenLeave: () => void;
  onAddVarField?: (id: string, fieldPath: string) => void;
  onRemoveVarField?: (id: string, fieldPath: string) => void;
  onVarFieldPortDown?: (e: MouseEvent, id: string, varFieldPath: string) => void;
  hasVarFieldConnection?: (varFieldPath: string) => boolean;
  exprNodesById?: Map<string, ExprNode>;
  selected?: boolean;
  /** True when selected OR the cursor is hovering over this node while drawing a wire.
   *  Controls the variadic trailing empty port (a connection target), mirroring RowsNodeCard's isExpanded. */
  isExpanded?: boolean;
  /** When true, the node is faded because it is not related to the selected node. */
  dimmed?: boolean;
  /** Read-only view (e.g. XR detail graph overlay). Hides every mutating
   *  affordance (drag, delete, op switch, literal/varField editing, resize)
   *  and disables keyboard delete. Any new mutating prop added here MUST also
   *  be gated below the `readOnly` checks in this component. */
  readOnly?: boolean;
}

export const ExprNodeCard = memo(function ExprNodeCard({
  node, dark, userC, isDrawing, connectedPortInfo, dirty = false, hasOutputConnection = false,
  onNodeDown, onOutputPortDown, onInputPortUp, onInputPortClick, onExprChange, onLiteralChange, onResizeStart, onDelete,
  onTogglePortOptional, onTokenHover, onTokenLeave,
  onAddVarField, onRemoveVarField, onVarFieldPortDown, hasVarFieldConnection, exprNodesById,
  selected, isExpanded: isExpandedProp, dimmed, readOnly,
}: ExprNodeCardProps) {
  const isExpanded = isExpandedProp ?? selected;
  const def = EXPR_NODE_DEFS[node.category];
  if (!def) return null;
  const isRawTemplate = node.category === 'raw-template';
  const isPredicate = !!def.hasPredicate;
  const activePortCount = def.variadic ? (node.portCount ?? def.inputs.length) : def.inputs.length;
  const allPorts = def.variadic
    ? Array.from({ length: activePortCount }, (_, i) => ({
        name: String.fromCharCode(65 + i),
        label: String.fromCharCode(65 + i),
        type: def.inputs[0].type,
      }))
    : def.inputs;
  // For variadic nodes the effect always keeps exactly one trailing empty port.
  // Hide it when the node is not expanded (selected or draw-hover) so only meaningful ports are visible.
  const activePorts = (def.variadic && !isExpanded) ? allPorts.slice(0, -1) : allPorts;
  const varPortIdx = isPredicate ? activePorts.findIndex(p => p.name === 'var') : -1;
  const varFields = isPredicate ? (node.varFields ?? []) : [];
  const varFieldTreeRows = isPredicate ? buildVarFieldRows(varFields).length : 0;
  const cardH = isRawTemplate ? (node.h ?? RAW_TEMPLATE_NODE_H) : exprNodeH(activePorts.length) + (varFieldTreeRows + (isPredicate && selected ? 1 : 0)) * EXPR_NODE_PORT_H;

  return (
    <NodeCardShell
      id={node.id}
      dataAttr="opnode-id"
      x={node.x} y={node.y} w={EXPR_NODE_W} h={cardH}
      isDrawing={isDrawing}
      dimmed={dimmed}
      readOnly={readOnly}
      onNodeDown={onNodeDown}
      onDeleteKey={onDelete}
      extraStyle={{ zIndex: 2 }}
    >
      {/* Input port dots — not rendered for raw-template nodes */}
      {!isRawTemplate && activePorts.map((port, i) => {
        const offset = isPredicate && varPortIdx >= 0 && i > varPortIdx ? varFieldTreeRows * EXPR_NODE_PORT_H : 0;
        return (
          <PortDot key={port.name}
            color={userC} right={false} dark={dark}
            top={EXPR_NODE_HDR_H + i * EXPR_NODE_PORT_H + EXPR_NODE_PORT_H / 2 - PORT_DOT_SIZE / 2 + offset}
            hasConnection={connectedPortInfo.has(port.name)} isDrawing={isDrawing}
            onMouseUp={e => onInputPortUp(e, node.id, port.name)}
            onClick={e => { e.stopPropagation(); if (!isDrawing && !readOnly) onInputPortClick?.(node.id, port.name); }}
          />
        );
      })}

      {/* varField output dots — positioned at the leaf row of each varField */}
      {isPredicate && varFields.map((vf, vfi) => (
        <PortDot key={`vf-${vf}`}
          color={userC} right dark={dark}
          top={EXPR_NODE_HDR_H + varFieldLeafRow(varFields, varPortIdx, vfi) * EXPR_NODE_PORT_H + EXPR_NODE_PORT_H / 2 - PORT_DOT_SIZE / 2}
          hasConnection={hasVarFieldConnection?.(vf) ?? false}
          isDrawing={isDrawing}
          onMouseDown={e => { e.stopPropagation(); onVarFieldPortDown?.(e, node.id, vf); }}
        />
      ))}

      {/* Output port dot — in header */}
      <PortDot color={userC} right top={EXPR_NODE_HDR_H / 2 - PORT_DOT_SIZE / 2} dark={dark}
        hasConnection={hasOutputConnection} isDrawing={isDrawing}
        onMouseDown={e => { e.stopPropagation(); onOutputPortDown(e, node.id); }}
      />

      <Paper elevation={selected ? 8 : 2} sx={{
        width: '100%', height: cardH,
        border: dirty ? `1.5px dashed ${alpha(userC, 0.6)}` : `1.5px solid ${alpha(userC, selected ? 1 : 0.5)}`,
        borderRadius: 1.5, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        background: dark
          ? `linear-gradient(140deg, ${alpha(userC, 0.15)} 0%, #1c1c1c 100%)`
          : `linear-gradient(140deg, ${alpha(userC, 0.05)} 0%, #fff 100%)`,
      }}>
        {/* Header */}
        <Box sx={{
          px: 0.75, height: EXPR_NODE_HDR_H, flexShrink: 0,
          background: dark ? alpha(userC, 0.22) : alpha(userC, 0.08),
          borderBottom: `1px solid ${alpha(userC, 0.2)}`,
          display: 'flex', alignItems: 'center', gap: 0.5,
        }}>
          <Typography variant="caption" fontWeight={700} noWrap
            sx={{ color: userC, fontSize: '0.65rem', flex: 1, lineHeight: 1 }}>
            {def.label}
          </Typography>
          {(node.taints?.length ?? 0) > 0 && (
            <Tooltip
              title={
                <Box>
                  {node.taints!.map(t => (
                    <Box key={t} sx={{ fontSize: '0.65rem' }}>
                      {t === 'forEach'
                        ? 'forEach scope'
                        : `Predicate scope: ${exprNodesById?.get(t) ? (EXPR_NODE_DEFS[exprNodesById.get(t)!.category]?.label ?? t) : t}`}
                    </Box>
                  ))}
                </Box>
              }
              placement="top"
              PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}
            >
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.7 }}>
                <Icon icon="mdi:autorenew" width={10} color={userC} />
              </Box>
            </Tooltip>
          )}
          {def.ops.length > 1 && (
            <select
              value={node.op ?? def.defaultOp}
              onChange={e => { if (!readOnly) onExprChange(node.id, e.target.value); }}
              onMouseDown={e => e.stopPropagation()}
              disabled={readOnly}
              style={{
                fontFamily: 'monospace', fontSize: '0.55rem',
                color: userC, background: 'transparent',
                border: `1px solid ${alpha(userC, 0.35)}`,
                borderRadius: 3, padding: '1px 2px',
                cursor: readOnly ? 'default' : 'pointer', flexShrink: 0,
                outline: 'none',
              }}
            >
              {def.ops.map(o => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>
          )}
          <Box component="span" sx={{
            fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1,
            px: 0.4, borderRadius: 0.4, flexShrink: 0,
            border: `1px solid ${alpha(userC, 0.3)}`, color: userC, opacity: 0.6,
          }}>
            {abbrevType(def.outputType)}
          </Box>
          <NodeCardDeleteButton
            accent={userC} selected={!!selected} readOnly={readOnly}
            onDelete={() => onDelete(node.id)}
            size={14} icon="mdi:close" iconSize={10}
          />
        </Box>

        {/* Raw-template textarea body */}
        {isRawTemplate ? (
          <textarea
            value={node.literals['value'] ?? ''}
            onChange={e => onLiteralChange(node.id, 'value', e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            readOnly={readOnly}
            style={{
              flex: 1, width: '100%', resize: 'none',
              padding: '4px 6px', boxSizing: 'border-box',
              background: 'transparent', border: 'none', outline: 'none',
              fontFamily: 'monospace', fontSize: '0.52rem', color: dark ? '#ccc' : '#333',
              lineHeight: 1.4, opacity: 0.85,
            }}
          />
        ) : null}

        {!isRawTemplate && (
          /* Input port rows, with varField rows injected after the 'var' port.
             The "add field" row is rendered after all ports to keep port positions stable. */
          <>
          {activePorts.flatMap((port, i) => {
            const info = connectedPortInfo.get(port.name);
            const connected = info !== undefined;
            const portRow = (
              <Box key={`port-${port.name}`} sx={{
                height: EXPR_NODE_PORT_H, flexShrink: 0, display: 'flex', alignItems: 'center',
                borderTop: i > 0 ? `1px solid ${alpha(userC, 0.1)}` : 'none',
                px: 1, gap: 0.5, overflow: 'hidden',
              }}>
                <Typography variant="caption" sx={{
                  fontFamily: 'monospace', fontSize: '0.58rem',
                  color: userC, opacity: connected ? 0.6 : 0.9, flexShrink: 0,
                }}>
                  {port.label}
                </Typography>
                {!connected && port.type && port.type !== 'any' && (
                  <Box component="span" sx={{
                    fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1,
                    px: 0.4, borderRadius: 0.4, flexShrink: 0,
                    border: `1px solid ${alpha(userC, 0.25)}`, color: userC, opacity: 0.45,
                  }}>
                    {abbrevType(port.type)}
                  </Box>
                )}
                {!connected && (
                  <input
                    value={node.literals[port.name] ?? ''}
                    onChange={e => onLiteralChange(node.id, port.name, e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    readOnly={readOnly}
                    style={{
                      flex: 1, minWidth: 0, border: 'none', outline: 'none',
                      background: 'transparent', fontFamily: 'monospace',
                      fontSize: '0.58rem', color: dark ? '#ccc' : '#333',
                      caretColor: userC,
                    }}
                    placeholder="literal…"
                  />
                )}
                {connected && (
                  <VarPill
                    color={refAccent(nodeIdToRef(info.srcNodeId), dark, info.srcNodeType)}
                    label={info.label}
                    tooltip={`${info.displayPath ?? (info.srcFieldPath !== 'output' ? `${nodeIdToRef(info.srcNodeId)}.${info.srcFieldPath.replace(/\?/g, '')}` : info.srcFieldPath)}${info.type ? ` · ${info.type}` : ''}`}
                    optional={info.optional}
                    onToggleOptional={onTogglePortOptional
                      ? e => { e.stopPropagation(); onTogglePortOptional(node.id, port.name); }
                      : undefined}
                    typeSuffix={info.type ? abbrevType(info.type) : undefined}
                    onMouseEnter={() => onTokenHover({ srcNodeId: info.srcNodeId, srcPath: info.srcFieldPath, tgtNodeId: node.id })}
                    onMouseLeave={onTokenLeave}
                  />
                )}
              </Box>
            );

            if (isPredicate && port.name === 'var') {
              const varFieldRows = buildVarFieldRows(varFields).map((row) => {
                const indent = 18 + row.depth * 10;
                return (
                  <Box key={`vf-${row.path}`} sx={{
                    height: EXPR_NODE_PORT_H, flexShrink: 0, display: 'flex', alignItems: 'center',
                    borderTop: `1px solid ${alpha(userC, row.depth === 0 ? 0.07 : 0.04)}`,
                    pl: `${indent}px`, pr: 1, gap: 0.5, overflow: 'hidden',
                  }}>
                    <Typography variant="caption" noWrap sx={{
                      fontFamily: 'monospace', fontSize: '0.58rem',
                      color: userC, opacity: row.isExportable ? 0.85 : 0.4,
                      flex: 1,
                    }}>
                      {row.key}:
                    </Typography>
                    {row.isExportable && selected && !readOnly && (
                      <>
                        <Box component="span" role="button" tabIndex={-1}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); onRemoveVarField?.(node.id, row.path); }}
                          sx={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 14, height: 14, borderRadius: 0.4, flexShrink: 0,
                            color: alpha(userC, 0.4), cursor: 'pointer',
                            '&:hover': { color: '#ef4444', bgcolor: alpha('#ef4444', 0.12) },
                          }}>
                          <Icon icon="mdi:close" width={9} />
                        </Box>
                        {/* spacer matching the absolute PortDot outside Paper */}
                        <Box sx={{ width: PORT_DOT_SIZE, flexShrink: 0 }} />
                      </>
                    )}
                  </Box>
                );
              });
              return [portRow, ...varFieldRows];
            }

            return [portRow];
          })}
          {isPredicate && selected && !readOnly && (
            <Box sx={{
              height: EXPR_NODE_PORT_H, flexShrink: 0, display: 'flex', alignItems: 'center',
              borderTop: `1px solid ${alpha(userC, 0.07)}`,
              pl: '18px', pr: 1, gap: 0.5, overflow: 'hidden',
            }}>
              <input
                placeholder="add field…"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    onAddVarField?.(node.id, e.currentTarget.value.trim());
                    e.currentTarget.value = '';
                  }
                }}
                style={{
                  flex: 1, minWidth: 0, border: 'none', outline: 'none',
                  background: 'transparent', fontFamily: 'monospace',
                  fontSize: '0.52rem', color: dark ? '#ccc' : '#333',
                  caretColor: userC,
                }}
              />
              <Icon icon="mdi:plus" width={10} style={{ color: userC, opacity: 0.5, flexShrink: 0 }} />
            </Box>
          )}
          </>
        )}
      </Paper>

      {/* Resize handle — raw-template only, sits on top of the Paper border */}
      {isRawTemplate && !readOnly && (
        <div
          role="button"
          tabIndex={-1}
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 6,
            cursor: 'ns-resize', zIndex: 4,
          }}
          onMouseDown={e => { e.stopPropagation(); onResizeStart?.(e, node.id); }}
        />
      )}
    </NodeCardShell>
  );
});
