import { Icon } from '@iconify/react';
import { Box, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MouseEvent } from 'react';
import { refAccent } from '../constants';
import { SegmentedControl, VarPill } from '../NodeCard';
import { EXPR_NODE_W, exprNodeCardH } from './exprGraphUtils';
import { EXPR_NODE_DEFS } from './ExprNodeDefs';
import { ExprEdge, ExprNode } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const DOT = 8;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ExprNodeCardProps {
  node: ExprNode;
  dark: boolean;
  userC: string;
  edgesByTgt: Map<string, ExprEdge[]>;
  /** Only set on the output node — shown as the target field label. */
  fieldPath?: string;
  onNodeDown: (e: MouseEvent, nodeId: string) => void;
  onOutPortDown: (e: MouseEvent, srcNodeId: string) => void;
  onInPortUp: (e: MouseEvent, tgtNodeId: string, tgtPort: string) => void;
  onToggleOptional: () => void;
  onValueChange: (value: string) => void;
  onOpChange: (op: string) => void;
  onDelete: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExprNodeCard({
  node, dark, userC, edgesByTgt, fieldPath,
  onNodeDown, onOutPortDown, onInPortUp,
  onToggleOptional, onValueChange, onOpChange, onDelete,
}: ExprNodeCardProps) {
  const h = exprNodeCardH(node);
  const isOutput = node.kind === 'output';

  const outDot = !isOutput ? (
    <div role="button" tabIndex={-1}
      style={{
        position: 'absolute', right: -DOT / 2, top: h / 2 - DOT / 2,
        width: DOT, height: DOT, borderRadius: '50%',
        background: userC, border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`,
        cursor: 'crosshair', zIndex: 3,
      }}
      onMouseDown={e => { e.stopPropagation(); onOutPortDown(e, node.id); }}
    />
  ) : null;

  const inDots = (() => {
    if (node.kind === 'ref' || node.kind === 'literal') return null;
    if (node.kind === 'output') {
      return (
        <div role="button" tabIndex={-1}
          style={{
            position: 'absolute', left: -DOT / 2, top: h / 2 - DOT / 2,
            width: DOT, height: DOT, borderRadius: '50%',
            background: userC, border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`,
            cursor: 'crosshair', zIndex: 3,
          }}
          onMouseUp={e => onInPortUp(e, node.id, 'input')}
        />
      );
    }
    // operation — one dot per input port
    const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === node.category);
    return def?.inputs.map((port, pi) => (
      <div key={port.name} role="button" tabIndex={-1}
        style={{
          position: 'absolute', left: -DOT / 2, top: 22 + pi * 20 + 10 - DOT / 2,
          width: DOT, height: DOT, borderRadius: '50%',
          background: (edgesByTgt.get(node.id) ?? []).some(e => e.tgtPort === port.name)
            ? userC : (dark ? '#555' : '#bbb'),
          border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`,
          cursor: 'crosshair', zIndex: 3,
        }}
        onMouseUp={e => onInPortUp(e, node.id, port.name)}
      />
    ));
  })();

  return (
    <div
      role="button" tabIndex={0}
      style={{
        position: 'absolute', left: node.x, top: node.y,
        width: EXPR_NODE_W, height: h, cursor: 'grab',
      }}
      onMouseDown={e => { e.stopPropagation(); onNodeDown(e, node.id); }}
      onKeyDown={e => { if (e.key === 'Delete' && !isOutput) onDelete(); }}
    >
      {outDot}
      {inDots}
      <Paper elevation={2} sx={{
        width: '100%', height: '100%',
        border: `1.5px dashed ${alpha(userC, 0.5)}`,
        borderRadius: 1, overflow: 'hidden',
        bgcolor: dark ? alpha(userC, 0.08) : alpha(userC, 0.03),
        display: 'flex', flexDirection: 'column',
      }}>
        {node.kind === 'ref' && (
          <RefBody node={node} dark={dark}
            onToggleOptional={onToggleOptional} onDelete={onDelete} />
        )}
        {node.kind === 'literal' && (
          <LiteralBody node={node} onValueChange={onValueChange} onDelete={onDelete} />
        )}
        {node.kind === 'operation' && (
          <OperationBody node={node} dark={dark} userC={userC}
            onOpChange={onOpChange} onDelete={onDelete} edgesByTgt={edgesByTgt} />
        )}
        {node.kind === 'output' && (
          <OutputBody fieldPath={fieldPath ?? ''} userC={userC} />
        )}
      </Paper>
    </div>
  );
}

// ── Sub-bodies ────────────────────────────────────────────────────────────────

function RefBody({ node, dark, onToggleOptional, onDelete }: {
  node: ExprNode; dark: boolean;
  onToggleOptional: () => void; onDelete: () => void;
}) {
  const color = refAccent(node.nodeRef ?? '', dark);
  return (
    <Box sx={{ px: 0.75, height: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <VarPill
        color={color}
        label={node.nodeRef ?? ''}
        tooltip={[node.nodeRef, node.fieldPath?.replace(/\?/g, '')].filter(Boolean).join('.')}
      />
      <Typography variant="caption" noWrap
        sx={{ fontFamily: 'monospace', fontSize: '0.57rem', flex: 1, minWidth: 0 }}>
        {node.fieldPath?.replace(/\?/g, '')}
      </Typography>
      <Box component="span" role="button" tabIndex={-1}
        onClick={e => { e.stopPropagation(); onToggleOptional(); }}
        sx={{
          cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.6rem', lineHeight: 1, flexShrink: 0,
          color: node.optional ? color : (dark ? '#666' : '#bbb'), '&:hover': { color },
        }}>?</Box>
      <Box component="span" role="button" tabIndex={-1}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        sx={{ cursor: 'pointer', opacity: 0.35, '&:hover': { opacity: 0.9 }, fontSize: '0.65rem', lineHeight: 1, flexShrink: 0 }}>×</Box>
    </Box>
  );
}

function LiteralBody({ node, onValueChange, onDelete }: {
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

function OperationBody({ node, dark, userC, onOpChange, onDelete, edgesByTgt }: {
  node: ExprNode; dark: boolean; userC: string;
  onOpChange: (op: string) => void; onDelete: () => void;
  edgesByTgt: Map<string, ExprEdge[]>;
}) {
  const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === node.category);
  if (!def) return null;
  const inEdges = edgesByTgt.get(node.id) ?? [];
  return (
    <Box sx={{ px: 0.75, py: 0.4, display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mb: 0.3 }}>
        <Typography variant="caption"
          sx={{ fontFamily: 'monospace', fontSize: '0.56rem', opacity: 0.55, flexShrink: 0 }}>
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
      {def.inputs.map(port => {
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

function OutputBody({ fieldPath, userC }: { fieldPath: string; userC: string }) {
  return (
    <Box sx={{ px: 0.75, height: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Icon icon="mdi:arrow-right-circle-outline" width={11}
        style={{ color: userC, opacity: 0.6, flexShrink: 0 }} />
      <Typography variant="caption" noWrap
        sx={{ fontFamily: 'monospace', fontSize: '0.57rem', opacity: 0.7, flex: 1, minWidth: 0 }}>
        {fieldPath.split('.').pop()}
      </Typography>
    </Box>
  );
}
