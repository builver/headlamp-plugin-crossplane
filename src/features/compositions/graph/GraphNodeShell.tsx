// ── GraphNodeShell ────────────────────────────────────────────────────────────
//
// Shared outer chrome for every interactive graph node (NodeCard, ExprOpNodeCard,
// and any future node type). Centralizes the standardized contract for:
//
//   - DOM identity:   `data-node-id` / `data-opnode-id`, role="button", tabIndex
//   - Positioning:    absolute left/top/width/height
//   - Interaction:    drag start (always allowed), click activate, keyboard
//                     Enter/Space activate, keyboard Delete (gated on readOnly),
//                     hover state
//   - Visual base:    cursor (crosshair when drawing, else grab), dimmed opacity,
//                     transition
//
// IMPORTANT — readOnly contract:
//   The shell's job is to enforce the contract for the OUTER div only:
//     - Drag (mousedown → onNodeDown) is always allowed, even in readOnly
//       (mirrors NodeCard's existing behavior so users can rearrange a frozen
//        graph for inspection).
//     - Keyboard Delete is GATED on !readOnly.
//   Any mutating affordance INSIDE the card body (delete X, edit inputs,
//   op-switch dropdown, add-field, resize handle, etc.) must be gated by the
//   consuming card itself using its own `readOnly` prop. See `<NodeCard>` and
//   `<ExprOpNodeCard>` for the established pattern. The shared
//   `<GraphNodeDeleteButton>` helper exported below is the canonical
//   readOnly-aware delete affordance for headers.

import { Icon } from '@iconify/react';
import { alpha, Box, useTheme } from '@mui/material';
import { CSSProperties, KeyboardEvent, memo, MouseEvent, ReactNode, useCallback } from 'react';

export interface GraphNodeShellProps {
  /** Node identity. Used for `data-{node-id|opnode-id}` and forwarded to handlers. */
  id: string;
  /** Discriminates which data attribute the shell sets. NodeCard → 'node-id',
   *  ExprOpNodeCard → 'opnode-id'. */
  dataAttr: 'node-id' | 'opnode-id';

  x: number; y: number; w: number; h: number;

  /** Disables every outer-div handler (drag, click, keyboard). Used for purely
   *  decorative instance cards in the forEach fan-out. Hover still fires so
   *  parents can react. */
  noHandlers?: boolean;

  /** Read-only view (XR detail overlay). Disables keyboard Delete; drag stays
   *  enabled. Cards must additionally gate body-level mutating UI. */
  readOnly?: boolean;
  /** True while the user is drawing a wire — flips cursor to crosshair. */
  isDrawing?: boolean;
  /** Fades the card out when not related to the selected node. */
  dimmed?: boolean;

  /** Drag-start. The shell stops propagation. Not called when noHandlers. */
  onNodeDown?: (e: MouseEvent, id: string) => void;
  /** Mouse click. The shell stops propagation. Not called when noHandlers. */
  onClick?: (id: string) => void;
  /** Enter/Space keyboard activation. */
  onActivate?: (id: string) => void;
  /** Keyboard Delete. Gated on !readOnly by the shell. */
  onDeleteKey?: (id: string) => void;

  /** Hover-state pump for cards that need to render hover affordances. */
  onHoverChange?: (hovered: boolean) => void;

  /** Style overrides merged into the outer div. Cards use this for mask /
   *  transform / filter / pointerEvents / zIndex / custom transition. The shell
   *  pre-fills the canonical defaults (position, size, cursor, opacity, base
   *  transition); overrides win. */
  extraStyle?: CSSProperties;
  /** Cursor override (e.g. instance card 'default'). */
  cursor?: CSSProperties['cursor'];

  children?: ReactNode;
}

/** Shared outer chrome. See file header for the readOnly contract. */
export const GraphNodeShell = memo(function GraphNodeShell({
  id, dataAttr, x, y, w, h,
  noHandlers, readOnly, isDrawing, dimmed,
  onNodeDown, onClick, onActivate, onDeleteKey, onHoverChange,
  extraStyle, cursor, children,
}: GraphNodeShellProps) {
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (noHandlers) return;
    e.stopPropagation();
    onNodeDown?.(e, id);
  }, [noHandlers, onNodeDown, id]);

  const handleClick = useCallback((e: MouseEvent) => {
    if (noHandlers) return;
    e.stopPropagation();
    onClick?.(id);
  }, [noHandlers, onClick, id]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (noHandlers) return;
    if (e.key === 'Enter' || e.key === ' ') {
      onActivate?.(id);
    } else if (e.key === 'Delete' && !readOnly) {
      onDeleteKey?.(id);
    }
  }, [noHandlers, readOnly, onActivate, onDeleteKey, id]);

  const handleMouseEnter = useCallback(() => onHoverChange?.(true), [onHoverChange]);
  const handleMouseLeave = useCallback(() => onHoverChange?.(false), [onHoverChange]);

  const baseStyle: CSSProperties = {
    position: 'absolute', left: x, top: y, width: w, height: h,
    cursor: cursor ?? (isDrawing ? 'crosshair' : 'grab'),
    opacity: dimmed ? 0.25 : 1,
    transition: 'opacity 0.15s',
  };

  const dataProps: Record<string, string> = {
    [`data-${dataAttr}`]: id,
  };

  return (
    <div
      role="button" tabIndex={0}
      {...dataProps}
      style={{ ...baseStyle, ...extraStyle }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
});

// ── GraphNodeDeleteButton ─────────────────────────────────────────────────────
//
// Canonical delete-X used inside node headers. Self-enforces the readOnly
// contract so callers can't accidentally render a delete affordance in a
// read-only view (the bug we just fixed for op nodes). Only renders when both
// `readOnly` is false AND the node is selected.

export interface GraphNodeDeleteButtonProps {
  /** Accent color of the host node. */
  accent: string;
  selected: boolean;
  readOnly?: boolean;
  onDelete: () => void;
  /** Visual size. Defaults to 16 to match NodeCard; ExprOpNodeCard uses 14. */
  size?: number;
  /** Icon override. Defaults to the trash can. */
  icon?: string;
  /** Icon glyph size. Defaults to size - 4. */
  iconSize?: number;
}

export const GraphNodeDeleteButton = memo(function GraphNodeDeleteButton({
  accent, selected, readOnly, onDelete, size = 16, icon = 'mdi:trash-can-outline', iconSize,
}: GraphNodeDeleteButtonProps) {
  const theme = useTheme();
  if (readOnly || !selected) return null;
  const glyph = iconSize ?? Math.max(9, size - 6);
  return (
    <Box component="span" role="button" tabIndex={-1}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onDelete(); }}
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: 0.5, flexShrink: 0,
        color: alpha(accent, 0.6), cursor: 'pointer',
        '&:hover': {
          color: theme.palette.error.main,
          bgcolor: alpha(theme.palette.error.main, 0.12),
        },
      }}>
      <Icon icon={icon} width={glyph} />
    </Box>
  );
});
