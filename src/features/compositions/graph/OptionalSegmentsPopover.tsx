import { Box, ClickAwayListener, Paper, Popper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { KeyboardEvent, memo, MouseEvent, useEffect } from 'react';

export interface OptionalSegmentsPopoverProps {
  anchorEl: HTMLElement | null;
  /** Path segments to show. Order matches the dot-path. */
  segments: { name: string; optional: boolean }[];
  /** Accent color used for the active `?` indicator. */
  color: string;
  onToggle: (idx: number, value: boolean) => void;
  onClose: () => void;
}

export const OptionalSegmentsPopover = memo(function OptionalSegmentsPopover({
  anchorEl, segments, color, onToggle, onClose,
}: OptionalSegmentsPopoverProps) {
  const open = !!anchorEl;

  useEffect(() => {
    if (!open) return;
    // Don't stopPropagation — other overlays may also want to handle Escape.
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleRowClick = (idx: number, current: boolean) => (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    onToggle(idx, !current);
  };
  const handleRowKey = (idx: number, current: boolean) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onToggle(idx, !current);
    }
  };

  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="bottom-start"
      modifiers={[
        { name: 'offset', options: { offset: [0, 4] } },
        { name: 'preventOverflow', enabled: true, options: { boundary: 'viewport' } },
      ]}
      sx={{ zIndex: 1500 }}
    >
      <ClickAwayListener onClickAway={onClose}>
        <Paper
          elevation={6}
          onMouseDown={e => e.stopPropagation()}
          sx={{
            minWidth: 160, maxWidth: 280, py: 0.5,
            border: `1px solid ${alpha(color, 0.4)}`,
          }}
        >
          <Typography variant="caption" sx={{
            display: 'block', px: 1.25, py: 0.5, opacity: 0.6,
            fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.4,
          }}>
            Optional segments
          </Typography>
          {segments.length === 0 ? (
            <Typography variant="caption" sx={{ display: 'block', px: 1.25, py: 0.5, opacity: 0.5 }}>
              (no segments)
            </Typography>
          ) : segments.map((seg, idx) => (
            <Box
              key={`${idx}-${seg.name}`}
              role="button"
              tabIndex={-1}
              onClick={handleRowClick(idx, seg.optional)}
              onKeyDown={handleRowKey(idx, seg.optional)}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 1, px: 1.25, py: 0.5, cursor: 'pointer',
                fontFamily: 'monospace', fontSize: '0.72rem',
                '&:hover': { bgcolor: alpha(color, 0.08) },
              }}
            >
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {seg.name}
              </Box>
              <Box component="span" sx={{
                fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1, flexShrink: 0,
                color: seg.optional ? color : 'action.disabled',
                fontWeight: seg.optional ? 700 : 400,
              }}>
                ?
              </Box>
            </Box>
          ))}
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
});
