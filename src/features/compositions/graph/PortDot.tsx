import { MouseEvent } from 'react';
import { PORT_DOT_SIZE } from './constants';

/**
 * A single connector dot on a node. Manages its own hover state and shows an ×
 * indicator when the port has an active connection and the user hovers over it.
 * Used by RowsNodeCard (left/right dots) and ExprNodeCard (input/output dots).
 */
export function PortDot({ color, right, top, dark, hasConnection, isDrawing, defaultCursor = 'crosshair', onMouseDown, onMouseUp, onClick }: {
  color: string; right: boolean; top: number; dark: boolean;
  /** Whether this port currently has at least one active edge — shows × on hover and changes cursor. */
  hasConnection: boolean;
  isDrawing: boolean;
  defaultCursor?: string;
  onMouseDown?: (e: MouseEvent) => void;
  onMouseUp?: (e: MouseEvent) => void;
  onClick?: (e: MouseEvent) => void;
}) {
  return (
    <div role="button" tabIndex={-1}
      style={{
        position: 'absolute',
        ...(right ? { right: -PORT_DOT_SIZE / 2 } : { left: -PORT_DOT_SIZE / 2 }),
        top, width: PORT_DOT_SIZE, height: PORT_DOT_SIZE, borderRadius: '50%',
        background: color, border: `2px solid ${dark ? '#1a1a1a' : '#fff'}`, zIndex: 3,
        cursor: hasConnection && !isDrawing ? 'pointer' : defaultCursor,
      }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onClick) onClick(e as unknown as MouseEvent); }}
    />
  );
}
