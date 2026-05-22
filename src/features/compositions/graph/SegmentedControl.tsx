import { Box } from '@mui/material';

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
