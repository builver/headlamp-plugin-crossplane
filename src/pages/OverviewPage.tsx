import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, TileChart } from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import { Configuration, CrossplaneFunction, Provider } from '../resources';

interface ResourceStatus {
  ready: number;
  notReady: number;
  total: number;
}

function getStatus(items: KubeObject[] | null): ResourceStatus {
  if (!items) return { ready: 0, notReady: 0, total: 0 };
  let ready = 0;
  let notReady = 0;
  for (const item of items) {
    const conditions: { type: string; status: string }[] =
      item.jsonData?.status?.conditions ?? [];
    const readyCond =
      conditions.find(c => c.type === 'Healthy') ?? conditions.find(c => c.type === 'Ready');
    if (readyCond?.status === 'True') {
      ready++;
    } else {
      notReady++;
    }
  }
  return { ready, notReady, total: items.length };
}

interface OverviewTileProps {
  label: string;
  route: string;
  items: KubeObject[] | null;
}

function OverviewTile({ label, route, items }: OverviewTileProps) {
  const theme = useTheme();
  const { ready, notReady, total } = getStatus(items);
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;

  const data = [
    { name: 'Ready', value: pct, fill: theme.palette.success.main },
    { name: 'Not Ready', value: 100 - pct, fill: theme.palette.error.main },
  ];

  const legend = (
    <Box>
      <Link routeName={route}>{label}</Link>
      <Box mt={1} fontSize="0.85rem">
        <div>{ready}/{total} ready</div>
        <div>{notReady}/{total} not ready</div>
      </Box>
    </Box>
  );

  return (
    <Box width="280px" m={2}>
      <TileChart data={data} total={100} label={`${pct}%`} legend={legend} />
    </Box>
  );
}

interface PodSectionProps {
  title: string;
  pods: KubeObject[];
  defaultExpanded?: boolean;
}

function PodSection({ title, pods, defaultExpanded = false }: PodSectionProps) {
  return (
    <Accordion defaultExpanded={defaultExpanded}>
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Typography variant="subtitle1">
          {title} ({pods.length})
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {pods.length === 0 ? (
          <Box p={2}>
            <Typography variant="body2" color="text.secondary">
              No pods found.
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Namespace</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Image</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pods.map(pod => {
                const containers: { image: string }[] =
                  pod.jsonData?.spec?.containers ?? [];
                const images = containers.map(c => c.image).join(', ');
                return (
                  <TableRow key={pod.metadata.uid}>
                    <TableCell>
                      <Link
                        routeName="pod"
                        params={{
                          name: pod.metadata.name,
                          namespace: pod.metadata.namespace,
                        }}
                      >
                        {pod.metadata.name}
                      </Link>
                    </TableCell>
                    <TableCell>{pod.metadata.namespace}</TableCell>
                    <TableCell>{pod.jsonData?.status?.phase ?? '-'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {images || '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export function OverviewPage() {
  const [providers] = Provider.useList();
  const [functions] = CrossplaneFunction.useList();
  const [configurations] = Configuration.useList();

  const [pods] = K8s.ResourceClasses.Pod.useList();

  const systemPods = React.useMemo(
    () =>
      pods?.filter(
        p =>
          p.metadata.labels?.['app'] === 'crossplane' ||
          p.metadata.labels?.['app'] === 'crossplane-rbac-manager'
      ) ?? [],
    [pods]
  );

  const providerPods = React.useMemo(
    () => pods?.filter(p => 'pkg.crossplane.io/provider' in (p.metadata.labels ?? {})) ?? [],
    [pods]
  );

  const functionPods = React.useMemo(
    () => pods?.filter(p => 'pkg.crossplane.io/function' in (p.metadata.labels ?? {})) ?? [],
    [pods]
  );

  const tiles = [
    { label: 'Providers', route: 'crossplane-providers', items: providers },
    { label: 'Functions', route: 'crossplane-functions', items: functions },
    { label: 'Configurations', route: 'crossplane-configurations', items: configurations },
  ];

  return (
    <>
      <SectionBox title="Crossplane Overview">
        <Box display="flex" flexWrap="wrap">
          {tiles.map(t => (
            <OverviewTile key={t.route} label={t.label} route={t.route} items={t.items} />
          ))}
        </Box>
      </SectionBox>

      <SectionBox title="Pods">
        <PodSection title="Crossplane System" pods={systemPods} defaultExpanded />
        <PodSection title="Providers" pods={providerPods} />
        <PodSection title="Functions" pods={functionPods} />
      </SectionBox>
    </>
  );
}
