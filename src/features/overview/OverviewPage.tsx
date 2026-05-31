import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  ResourceTable,
  SectionBox,
  StatusLabel,
  TileChart,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Collapse,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import {
  CompositeResourceDefinition,
  Configuration,
  CrossplaneFunction,
  makeXRClass,
  ManagedResourceDefinition,
  Provider,
} from '../../resources';

interface ResourceStatus {
  ready: number;
  notReady: number;
  total: number;
}

function getStatus(items: KubeObject[] | null, conditionType = 'Healthy'): ResourceStatus {
  if (!items) return { ready: 0, notReady: 0, total: 0 };
  let ready = 0;
  let notReady = 0;
  for (const item of items) {
    const conditions: { type: string; status: string }[] =
      item.jsonData?.status?.conditions ?? [];
    const readyCond =
      conditions.find(c => c.type === conditionType) ?? conditions.find(c => c.type === 'Ready');
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
  routeName: string;
  params?: Record<string, string>;
  items: KubeObject[] | null;
  conditionType?: string;
}

function OverviewTile({ label, routeName, params, items, conditionType }: OverviewTileProps) {
  const theme = useTheme();
  const { ready, notReady, total } = getStatus(items, conditionType);
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  const statusLabel = conditionType === 'Established' ? 'established' : 'ready';

  const notReadyColor =
    conditionType === 'Established' ? theme.palette.grey[400] : theme.palette.error.main;
  const data = [
    { name: statusLabel, value: pct, fill: theme.palette.success.main },
    { name: `not ${statusLabel}`, value: 100 - pct, fill: notReadyColor },
  ];

  const legend = (
    <Box>
      <Link routeName={routeName} params={params}>{label}</Link>
      <Box mt={1} fontSize="0.85rem">
        <div>{ready}/{total} {statusLabel}</div>
        <div>{notReady}/{total} not {statusLabel}</div>
      </Box>
    </Box>
  );

  return (
    <Box width="280px" m={2}>
      <TileChart data={data} total={100} label={`${pct}%`} legend={legend} />
    </Box>
  );
}

type SortOption = 'most-ready' | 'least-ready' | 'most-total' | 'least-total' | 'alpha-az' | 'alpha-za';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'most-ready', label: 'Most Ready First' },
  { value: 'least-ready', label: 'Least Ready First' },
  { value: 'most-total', label: 'Most Total Resources' },
  { value: 'least-total', label: 'Least Total Resources' },
  { value: 'alpha-az', label: 'Alphabetical A-Z' },
  { value: 'alpha-za', label: 'Alphabetical Z-A' },
];

function XRKindTile({
  xrd,
  onStatus,
}: {
  xrd: KubeObject;
  onStatus?: (uid: string, status: ResourceStatus) => void;
}) {
  const plural = xrd.jsonData?.spec?.names?.plural as string;
  const kind = xrd.jsonData?.spec?.names?.kind as string;
  const DynClass = React.useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);
  const [items] = DynClass.useList();
  const status = getStatus(items, 'Ready');
  const { ready, notReady, total } = status;

  const onStatusRef = React.useRef(onStatus);
  onStatusRef.current = onStatus;
  const uid = xrd.metadata.uid;

  React.useEffect(() => {
    onStatusRef.current?.(uid, { ready, notReady, total });
  }, [uid, ready, notReady, total]);

  return (
    <OverviewTile
      label={kind}
      routeName="crossplane-xr-list"
      params={{ plural }}
      items={items}
      conditionType="Ready"
    />
  );
}

function PodPhaseLabel({ pod }: { pod: KubeObject }) {
  const phase = (pod.jsonData?.status?.phase as string) ?? 'Unknown';
  const status: 'success' | 'warning' | 'error' | '' =
    phase === 'Running' || phase === 'Succeeded'
      ? 'success'
      : phase === 'Pending'
        ? 'warning'
        : phase === 'Failed'
          ? 'error'
          : '';
  return <StatusLabel status={status}>{phase}</StatusLabel>;
}

interface PodSectionProps {
  title: string;
  pods: KubeObject[];
  defaultExpanded?: boolean;
}

function PodSection({ title, pods, defaultExpanded = false }: PodSectionProps) {
  const running = pods.filter(p => p.jsonData?.status?.phase === 'Running').length;
  const allRunning = pods.length > 0 && running === pods.length;

  return (
    <Accordion defaultExpanded={defaultExpanded}>
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="subtitle1">{title}</Typography>
          {pods.length > 0 && (
            <Chip
              size="small"
              label={`${running}/${pods.length} Running`}
              color={allRunning ? 'success' : 'warning'}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {pods.length === 0 ? (
          <Box p={2}>
            <Typography variant="body2" color="text.secondary">
              No pods found.
            </Typography>
          </Box>
        ) : (
          <ResourceTable.default
            data={pods}
            columns={[
              'name',
              {
                label: 'Namespace',
                getValue: (pod: KubeObject) => pod.metadata.namespace ?? '',
                render: (pod: KubeObject) =>
                  pod.metadata.namespace ? (
                    <Link routeName="namespace" params={{ name: pod.metadata.namespace }}>
                      {pod.metadata.namespace}
                    </Link>
                  ) : (
                    '-'
                  ),
              },
              {
                label: 'Status',
                getValue: (pod: KubeObject) => pod.jsonData?.status?.phase ?? '-',
                render: (pod: KubeObject) => <PodPhaseLabel pod={pod} />,
              },
              {
                label: 'Image',
                getValue: (pod: KubeObject) => {
                  const containers: { image: string }[] = pod.jsonData?.spec?.containers ?? [];
                  return containers.map(c => c.image).join(', ') || '-';
                },
                render: (pod: KubeObject) => {
                  const containers: { image: string }[] = pod.jsonData?.spec?.containers ?? [];
                  const images = containers.map(c => c.image).join(', ');
                  return (
                    <Box sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {images || '-'}
                    </Box>
                  );
                },
              },
              'age',
            ]}
          />
        )}
      </AccordionDetails>
    </Accordion>
  );
}

const PREVIEW_COUNT = 3;

function CompositeResourcesSection({ xrds }: { xrds: KubeObject[] | null }) {
  const [sortOption, setSortOption] = React.useState<SortOption>('least-ready');
  const [statusMap, setStatusMap] = React.useState<Record<string, ResourceStatus>>({});
  const [expanded, setExpanded] = React.useState(false);

  const handleStatus = React.useCallback((uid: string, status: ResourceStatus) => {
    setStatusMap(prev => {
      if (prev[uid]?.ready === status.ready && prev[uid]?.total === status.total) return prev;
      return { ...prev, [uid]: status };
    });
  }, []);

  const sortedXrds = React.useMemo(() => {
    if (!xrds) return [];
    return [...xrds].sort((a, b) => {
      const kindA = (a.jsonData?.spec?.names?.kind as string) ?? '';
      const kindB = (b.jsonData?.spec?.names?.kind as string) ?? '';
      const sA = statusMap[a.metadata.uid] ?? { ready: 0, notReady: 0, total: 0 };
      const sB = statusMap[b.metadata.uid] ?? { ready: 0, notReady: 0, total: 0 };
      switch (sortOption) {
        case 'most-ready':
          return sB.ready - sA.ready;
        case 'least-ready':
          return sA.ready - sB.ready;
        case 'most-total':
          return sB.total - sA.total;
        case 'least-total':
          return sA.total - sB.total;
        case 'alpha-az':
          return kindA.localeCompare(kindB);
        case 'alpha-za':
          return kindB.localeCompare(kindA);
        default:
          return 0;
      }
    });
  }, [xrds, sortOption, statusMap]);

  const previewXrds = sortedXrds.slice(0, PREVIEW_COUNT);
  const remainingXrds = sortedXrds.slice(PREVIEW_COUNT);

  return (
    <SectionBox title="Composite Resources">
      <Paper variant="outlined">
        {/* Header */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          px={2}
          sx={{ minHeight: 48, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
          onClick={() => setExpanded(v => !v)}
        >
          <Typography variant="subtitle1">
            Composite Resource Kinds ({xrds?.length ?? 0})
          </Typography>
          <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </Box>

        {/* Body */}
        {!xrds || xrds.length === 0 ? (
          <Box p={2}>
            <Typography variant="body2" color="text.secondary">
              No composite resource definitions found.
            </Typography>
          </Box>
        ) : (
          <>
            {/* Sort control — always visible */}
            <Box display="flex" justifyContent="flex-end" px={2} pt={1}>
              <Box display="flex" flexDirection="column" alignItems="flex-start">
                <Typography variant="caption" color="text.secondary">
                  Sort by
                </Typography>
                <Select
                  size="small"
                  value={sortOption}
                  onChange={e => setSortOption(e.target.value as SortOption)}
                >
                  {SORT_OPTIONS.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            </Box>
            {/* Preview tiles — always visible */}
            <Box display="flex" flexWrap="wrap" px={1}>
              {previewXrds.map(xrd => (
                <XRKindTile key={xrd.metadata.uid} xrd={xrd} onStatus={handleStatus} />
              ))}
            </Box>
            {/* Remaining tiles — shown when expanded; kept mounted so hooks run */}
            <Collapse in={expanded}>
              <Box display="flex" flexWrap="wrap" px={1} pb={1}>
                {remainingXrds.map(xrd => (
                  <XRKindTile key={xrd.metadata.uid} xrd={xrd} onStatus={handleStatus} />
                ))}
              </Box>
            </Collapse>
          </>
        )}
      </Paper>
    </SectionBox>
  );
}

export function OverviewPage() {
  const [providers] = Provider.useList();
  const [functions] = CrossplaneFunction.useList();
  const [configurations] = Configuration.useList();
  const [xrds] = CompositeResourceDefinition.useList();
  const [mrds] = ManagedResourceDefinition.useList();

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
    { label: 'Providers', routeName: 'crossplane-providers', items: providers },
    { label: 'Functions', routeName: 'crossplane-functions', items: functions },
    { label: 'Configurations', routeName: 'crossplane-configurations', items: configurations },
    {
      label: 'Managed Resource Activations',
      routeName: 'crossplane-mraps-list',
      items: mrds,
      conditionType: 'Established',
    },
  ];

  return (
    <>
      <SectionBox title="Crossplane Overview">
        <Box display="flex" flexWrap="wrap">
          {tiles.map(t => (
            <OverviewTile
              key={t.routeName}
              label={t.label}
              routeName={t.routeName}
              items={t.items}
              conditionType={t.conditionType}
            />
          ))}
        </Box>
      </SectionBox>

      <CompositeResourcesSection xrds={xrds} />

      <SectionBox title="Pods">
        <PodSection title="Crossplane System" pods={systemPods} />
        <PodSection title="Providers" pods={providerPods} />
        <PodSection title="Functions" pods={functionPods} />
      </SectionBox>
    </>
  );
}
