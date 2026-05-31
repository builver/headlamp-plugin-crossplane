import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { memo, MouseEvent } from 'react';

export interface VarPillProps {
  color: string;
  label: string;
  tooltip?: string;
  /** When true, a read-only `?` indicator is rendered after the label to signal
   *  that at least one path segment is marked optional. The indicator itself is
   *  no longer a click target — use `onOpenSegmentsMenu` to edit per-segment `?`. */
  optional?: boolean;
  /** When provided, the whole pill body becomes clickable and opens the optional-
   *  segments popover anchored to the pill. Receives the pill DOM node as the
   *  popover anchor. */
  onOpenSegmentsMenu?: (anchor: HTMLElement) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Abbreviated type rendered as a faint sub-pill inside (e.g. "str", "bool") */
  typeSuffix?: string;
}

export const VarPill = memo(function VarPill({
  color, label, tooltip, optional, onOpenSegmentsMenu,
  onMouseEnter, onMouseLeave, typeSuffix,
}: VarPillProps) {
  const clickable = !!onOpenSegmentsMenu;
  const handleClick = clickable
    ? (e: MouseEvent<HTMLElement>) => { e.stopPropagation(); onOpenSegmentsMenu!(e.currentTarget); }
    : undefined;
  const handleMouseDown = clickable
    ? (e: MouseEvent<HTMLElement>) => { e.stopPropagation(); }
    : undefined;

  const pill = (
    <Box
      component="span"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? -1 : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.25,
        fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
        px: 0.5, py: 0.15, borderRadius: 0.5, flexShrink: 0,
        bgcolor: alpha(color, 0.12), color,
        border: `1px solid ${alpha(color, 0.3)}`,
        cursor: clickable ? 'pointer' : 'default', overflow: 'hidden',
        transition: 'background-color 80ms ease, border-color 80ms ease',
        ...(clickable && {
          '&:hover': {
            bgcolor: alpha(color, 0.22),
            borderColor: alpha(color, 0.55),
          },
        }),
      }}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Box>
      {optional && (
        // Read-only indicator that at least one segment is optional. Open the
        // segments popover (via the surrounding pill click) to edit.
        <Box component="span" sx={{
          fontFamily: 'monospace', fontSize: '0.6rem', lineHeight: 1, flexShrink: 0, color,
        }}>?</Box>
      )}
      {typeSuffix && (
        <Box component="span" sx={{
          fontFamily: 'monospace', fontSize: '0.5rem', lineHeight: 1,
          px: 0.4, borderRadius: 0.4, flexShrink: 0,
          border: `1px solid ${alpha(color, 0.25)}`, color, opacity: 0.5,
        }}>
          {typeSuffix}
        </Box>
      )}
    </Box>
  );
  if (!tooltip) return pill;
  return (
    <Tooltip title={tooltip} placement="top" PopperProps={{ modifiers: [{ name: 'preventOverflow', enabled: false }] }}>
      {pill}
    </Tooltip>
  );
});
