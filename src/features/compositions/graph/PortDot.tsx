import { MouseEvent } from 'react';
import { DOT } from './constants';

/**
 * A single connector dot on a node. Manages its own hover state and shows an ×
 * indicator when the port has an active connection and the user hovers over it.
 * Used by NodeCard (left/right dots) and ExprOpNodeCard (input/output dots).
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
        ...(right ? { right: -DOT / 2 } : { left: -DOT / 2 }),
        top, width: DOT, height: DOT, borderRadius: '50%',
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
