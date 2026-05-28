import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { Link as MuiLink } from '@mui/material';
import { ReactNode } from 'react';

export const linkSx = { background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' } as const;

interface ActivityNameLinkProps {
  item: any;
  kindLabel: string;
  content: ReactNode;
  location?: 'split-right' | 'full';
  icon?: ReactNode;
}

export function ActivityNameLink({
  item,
  kindLabel,
  content,
  location = 'split-right',
  icon,
}: ActivityNameLinkProps) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-${kindLabel.toLowerCase().replace(/\s+/g, '')}-${item.metadata.name}`,
      title: `${kindLabel} ${item.metadata.name}`,
      hideTitleInHeader: true,
      location,
      cluster: item.cluster,
      icon,
      content,
    });
  return (
    <MuiLink component="button" onClick={launch} sx={linkSx}>
      {item.metadata.name}
    </MuiLink>
  );
}
