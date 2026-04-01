import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, TileChart } from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import {
  CompositeResourceDefinition,
  Composition,
  Configuration,
  CrossplaneFunction,
  Provider,
} from '../resources';

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
    const readyCond = conditions.find(c => c.type === 'Ready');
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

export function OverviewPage() {
  const [xrds] = CompositeResourceDefinition.useList();
  const [compositions] = Composition.useList();
  const [providers] = Provider.useList();
  const [functions] = CrossplaneFunction.useList();
  const [configurations] = Configuration.useList();

  // Crossplane system pods (crossplane + crossplane-rbac-manager)
  const [pods] = K8s.ResourceClasses.Pod.useList();
  const crossplanePods = React.useMemo(
    () =>
      pods?.filter(
        p =>
          p.metadata.labels?.['app'] === 'crossplane' ||
          p.metadata.labels?.['app'] === 'crossplane-rbac-manager'
      ) ?? [],
    [pods]
  );

  const tiles = [
    { label: 'XRDs', route: 'crossplane-xrds', items: xrds },
    { label: 'Compositions', route: 'crossplane-compositions', items: compositions },
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

      <SectionBox title="System Pods">
        <Box p={1}>
          {crossplanePods.length === 0 ? (
            <span>No Crossplane system pods found in the current cluster.</span>
          ) : (
            crossplanePods.map(pod => (
              <Box key={pod.metadata.uid} display="flex" gap={2} mb={0.5}>
                <Link routeName="pod" params={{ name: pod.metadata.name, namespace: pod.metadata.namespace }}>
                  {pod.metadata.name}
                </Link>
                <span>{pod.jsonData?.status?.phase ?? '-'}</span>
              </Box>
            ))
          )}
        </Box>
      </SectionBox>
    </>
  );
}
