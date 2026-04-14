import { Icon } from '@iconify/react';
import {
  ConditionsTable,
  CreateResourceButton,
  DataField,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { MatchExpressions } from '@kinvolk/headlamp-plugin/lib/components/common/Resource';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { stringify as yamlStringify } from 'yaml';
import { makeCompositeTypeColumn, makeXRNameColumn, readyColumn, syncedColumn } from '../components/columns';
import {
  CompositeResourceDefinition,
  Composition,
  getCompositionRef,
  getXRScope,
  makeXRClass,
  XRScope,
} from '../resources';

const MAX_VISIBLE_STEPS = 7;


interface RequiredResource {
  requirementName: string;
  apiVersion: string;
  kind: string;
  name?: string;
  matchLabels?: Record<string, string>;
  namespace?: string;
}

interface RequiredSchema {
  requirementName: string;
  apiVersion: string;
  kind: string;
}

interface PipelineStepRequirements {
  requiredResources?: RequiredResource[];
  requiredSchemas?: RequiredSchema[];
}

interface PipelineStep {
  step: string;
  functionRef: { name: string };
  input?: Record<string, unknown>;
  requirements?: PipelineStepRequirements;
}

function PipelineSteps({ item }: { item: KubeObject }) {
  const theme = useTheme();
  const steps: PipelineStep[] = item.jsonData?.spec?.pipeline ?? [];

  if (steps.length === 0) return <span>-</span>;

  const visible = steps.slice(0, MAX_VISIBLE_STEPS);
  const overflow = steps.slice(MAX_VISIBLE_STEPS);

  return (
    <Box display="flex" alignItems="center" flexWrap="nowrap">
      {visible.map((s, i) => (
        <React.Fragment key={s.step}>
          {i > 0 && (
            <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: 'primary.main', opacity: 0.4 }} />
          )}
          <Tooltip
            title={
              <Box>
                <div><strong>{s.step}</strong></div>
                {s.functionRef?.name && (
                  <Link routeName={`crossplane-function-detail-${s.functionRef.name}`}>
                    <Box display="flex" alignItems="center" gap={0.5} component="span">
                      <Icon icon="mdi:function" width="1em" height="1em" />
                      {s.functionRef.name}
                    </Box>
                  </Link>
                )}
              </Box>
            }
          >
            <Box component="span" sx={{ cursor: 'default', lineHeight: 0, flexShrink: 0 }}>
              <Icon
                icon="mdi:circle"
                width="0.875rem"
                height="0.875rem"
                style={{ color: theme.palette.primary.main }}
              />
            </Box>
          </Tooltip>
        </React.Fragment>
      ))}
      {overflow.length > 0 && (
        <>
          <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: 'primary.main', opacity: 0.4 }} />
          <Tooltip title={overflow.map(s => s.step).join(', ')}>
            <Box
              component="span"
              sx={{
                cursor: 'default',
                fontSize: '0.75rem',
                color: 'primary.main',
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              +{overflow.length}
            </Box>
          </Tooltip>
        </>
      )}
    </Box>
  );
}

export function CompositionListPage() {
  const filterFunction = useFilterFunc();
  const [compositions, error] = Composition.useList();
  const [xrds] = CompositeResourceDefinition.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Compositions">
        <p>Compositions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Compositions"
          titleSideActions={[<CreateResourceButton resourceClass={Composition} resourceName="Composition" />]}
        />
      }
    >
      <ResourceTable.default
        data={compositions}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => (
              <Link routeName={`crossplane-composition-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          makeCompositeTypeColumn(xrds),
          {
            label: 'Pipeline',
            getValue: item =>
              (item.jsonData?.spec?.pipeline ?? []).map((s: PipelineStep) => s.step).join(', '),
            render: item => <PipelineSteps item={item} />,
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

interface ComposedXRsProps {
  xrd: KubeObject;
  compositionName: string;
}

function ComposedXRs({ xrd, compositionName }: ComposedXRsProps) {
  const filterFunction = useFilterFunc();
  const scope: XRScope = getXRScope(xrd);
  const plural = xrd.jsonData?.spec?.names?.plural ?? '';
  const DynClass = useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);
  const [items] = DynClass.useList();

  const filtered = useMemo(
    () => items?.filter(item => getCompositionRef(item, scope) === compositionName) ?? [],
    [items, compositionName, scope]
  );

  return (
    <SectionBox title="Composite Resources">
      <ResourceTable.default
        data={filtered}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          makeXRNameColumn(plural, scope),
          ...(scope === 'Namespaced' ? ['namespace' as const] : []),
          readyColumn,
          syncedColumn,
          'age' as const,
        ]}
      />
    </SectionBox>
  );
}

export function CompositionDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [comp] = Composition.useGet(name);
  const [xrds] = CompositeResourceDefinition.useList();

  const compTypeRef = comp?.jsonData?.spec?.compositeTypeRef;

  const matchingXrd = React.useMemo(() => {
    if (!xrds || !compTypeRef) return null;
    const group = (compTypeRef.apiVersion as string)?.split('/')[0] ?? '';
    return xrds.find(
      x => x.jsonData?.spec?.names?.kind === compTypeRef.kind && x.jsonData?.spec?.group === group
    ) ?? null;
  }, [xrds, compTypeRef]);

  const extraInfo = comp
    ? [
        {
          name: 'Composite Resource',
          value: compTypeRef
            ? matchingXrd
              ? <Link routeName={`crossplane-xr-kind-${matchingXrd.jsonData?.spec?.names?.plural}`}>{compTypeRef.kind}</Link>
              : compTypeRef.kind
            : '-',
        },
        {
          name: 'Mode',
          value: comp.jsonData?.spec?.mode ?? 'Resources',
        },
        {
          name: 'Composition Revision Policy',
          value: comp.jsonData?.spec?.publishConnectionDetailsWithStoreConfigRef?.name ?? '-',
        },
      ]
    : [];

  const pipeline: PipelineStep[] = comp?.jsonData?.spec?.pipeline ?? [];

  const pipelineInputYaml = useMemo(
    () => new Map(pipeline.filter(s => s.input).map(s => [s.step, yamlStringify(s.input!, { blockQuote: true })])),
    [pipeline]
  );

  return (
    <>
      <MainInfoSection resource={comp} extraInfo={extraInfo} />
      {comp && <ConditionsTable resource={comp.jsonData} />}
      {pipeline.length > 0 && (
        <SectionBox title="Pipeline">
          {pipeline.map((s, i) => (
            <Accordion key={s.step} defaultExpanded={i === 0}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box display="flex" alignItems="center" width="100%" gap={1}>
                  <Typography variant="subtitle1">{s.step}</Typography>
                  {s.functionRef?.name && (
                    <Box ml="auto" mr={1}>
                      <Link routeName={`crossplane-function-detail-${s.functionRef.name}`}>
                        <Chip
                          label={s.functionRef.name}
                          size="small"
                          icon={<Icon icon="mdi:function" />}
                          clickable
                        />
                      </Link>
                    </Box>
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" gap={1.5}>
                  {pipelineInputYaml.has(s.step) && (
                    <Box>
                      <Typography variant="overline" display="block" gutterBottom>Input</Typography>
                      <DataField
                        label="input.yaml"
                        disableLabel
                        value={pipelineInputYaml.get(s.step)!}
                        onChange={() => {}}
                      />
                    </Box>
                  )}
                  {(s.requirements?.requiredResources?.length ?? 0) > 0 && (
                    <Box>
                      <Typography variant="overline" display="block" gutterBottom>Required Resources</Typography>
                      <Table
                        data={s.requirements!.requiredResources!}
                        columns={[
                          { header: 'Name', accessorKey: 'requirementName' },
                          { header: 'API Version', accessorKey: 'apiVersion' },
                          { header: 'Kind', accessorKey: 'kind' },
                          {
                            header: 'Selector',
                            accessorFn: (r: RequiredResource) =>
                              r.name ?? Object.entries(r.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`).join(', '),
                            Cell: ({ row }: { row: { original: RequiredResource } }) =>
                              row.original.name
                                ? <>{row.original.name}</>
                                : <MatchExpressions matchLabels={row.original.matchLabels} />,
                          },
                          {
                            header: 'Namespace',
                            accessorFn: (r: RequiredResource) => r.namespace ?? '-',
                          },
                        ]}
                      />
                    </Box>
                  )}
                  {(s.requirements?.requiredSchemas?.length ?? 0) > 0 && (
                    <Box>
                      <Typography variant="overline" display="block" gutterBottom>Required Schemas</Typography>
                      <Table
                        data={s.requirements!.requiredSchemas!}
                        columns={[
                          { header: 'Name', accessorKey: 'requirementName' },
                          { header: 'API Version', accessorKey: 'apiVersion' },
                          { header: 'Kind', accessorKey: 'kind' },
                        ]}
                      />
                    </Box>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </SectionBox>
      )}
      {matchingXrd && comp && (
        <ComposedXRs xrd={matchingXrd} compositionName={comp.metadata.name} />
      )}
    </>
  );
}
