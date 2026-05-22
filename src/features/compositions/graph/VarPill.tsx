import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { memo, MouseEvent } from 'react';

export interface VarPillProps {
  color: string;
  label: string;
  tooltip?: string;
  optional?: boolean;
  onToggleOptional?: (e: MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Abbreviated type rendered as a faint sub-pill inside (e.g. "str", "bool") */
  typeSuffix?: string;
}

export const VarPill = memo(function VarPill({
  color, label, tooltip, optional, onToggleOptional,
  onMouseEnter, onMouseLeave, typeSuffix,
}: VarPillProps) {
  const pill = (
    <Box
      component="span"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.25,
        fontFamily: 'monospace', fontSize: '0.57rem', lineHeight: 1,
        px: 0.5, py: 0.15, borderRadius: 0.5, flexShrink: 0,
        bgcolor: alpha(color, 0.12), color,
        border: `1px solid ${alpha(color, 0.3)}`,
        cursor: 'default', overflow: 'hidden',
      }}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Box>
      {optional !== undefined && onToggleOptional && (
        <Box component="span" role="button" tabIndex={-1}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onToggleOptional(e); }}
          sx={{
            cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.6rem', lineHeight: 1, flexShrink: 0,
            color: optional ? color : 'action.disabled',
            '&:hover': { color },
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
