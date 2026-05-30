import { Box, Divider, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';
import { EXPR_NODE_DEFS } from './exprGraph/exprNodeDefs';
import { NodeDef } from './exprGraph/types';

const GROUP_ORDER = ['Logic', 'String', 'Collection', 'Type / Math', 'Advanced'] as const;

interface ExprNodePaletteProps {
  userC: string;
  onAdd: (def: NodeDef) => void;
  onClose: () => void;
}

export function ExprNodePalette({ userC, onAdd, onClose }: ExprNodePaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const allDefs = Object.values(EXPR_NODE_DEFS);
  const q = query.toLowerCase();
  const filtered = q ? allDefs.filter(d => d.label.toLowerCase().includes(q)) : null;

  const btnSx = {
    fontFamily: 'monospace', fontSize: '0.65rem', px: 0.75, py: 0.3,
    borderRadius: 0.5, border: `1px solid ${alpha(userC, 0.3)}`,
    bgcolor: 'transparent', color: userC, cursor: 'pointer', textAlign: 'left' as const,
    '&:hover': { bgcolor: alpha(userC, 0.1) },
  };

  return (
    <Paper
      elevation={4}
      onMouseDown={e => e.stopPropagation()}
      sx={{
        position: 'absolute', top: 40, right: 8, zIndex: 20,
        minWidth: 220, maxHeight: 400, overflowY: 'auto',
        border: `1px solid ${alpha(userC, 0.3)}`,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <Box sx={{ px: 0.75, py: 0.4 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="filter ops…"
          style={{
            width: '100%', background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'monospace', fontSize: '0.7rem', color: 'inherit',
          }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
        />
      </Box>
      <Divider />
      <Box sx={{ p: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {filtered ? (
          filtered.length === 0 ? (
            <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.4, px: 0.25 }}>
              No match
            </Typography>
          ) : (
            filtered.map(def => (
              <Box key={def.category} component="button" onClick={() => onAdd(def)} sx={btnSx}>
                {def.label}
              </Box>
            ))
          )
        ) : (
          GROUP_ORDER.map(group => {
            const defs = allDefs.filter(d => d.group === group);
            return (
              <Box key={group}>
                <Typography variant="caption" sx={{
                  fontSize: '0.6rem', fontWeight: 700, opacity: 0.45, textTransform: 'uppercase',
                  letterSpacing: '0.06em', display: 'block', mb: 0.4,
                }}>
                  {group}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
                  {defs.map(def => (
                    <Box key={def.category} component="button" onClick={() => onAdd(def)} sx={btnSx}>
                      {def.label}
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Paper>
  );
}
